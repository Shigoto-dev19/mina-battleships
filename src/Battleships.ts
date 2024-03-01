import { 
    Field, 
    UInt8,
    state, 
    State,
    method,
    SmartContract, 
    Provable,
    Poseidon,
    Bool,
    MerkleWitness,
} from 'o1js';

import { 
    BoardUtils,
    BoardCircuit, 
    AttackUtils,
    AttackCircuit, 
} from './provableUtils.js'; 

export { 
    Battleships,
    TargetMerkleWitness,
    HitMerkleWitness, 
    EMPTY_TREE8_ROOT,
}

const EMPTY_TREE8_ROOT = Field(14472842460125086645444909368571209079194991627904749620726822601198914470820n);

class TargetMerkleWitness extends MerkleWitness(8) {}
class HitMerkleWitness extends MerkleWitness(8) {}

class Battleships extends SmartContract { 
    @state(Field) player1Id = State<Field>();
    @state(Field) player2Id = State<Field>();
    @state(UInt8) turns = State<UInt8>();
    @state(Field) target = State<Field>();
    @state(Field) targetRoot = State<Field>();
    @state(Bool) hitResult = State<Bool>();
    @state(Field) hitRoot = State<Field>();
    @state(Field) serializedHitHistory = State<Field>();

    events = { 
        "Game Hosted: A new Battleships game has been initiated!": Field,
        "Player Joined: A new player has joined the hosted game!": Field,
        "Game Started: The host has played the opening shot!": Field,
        "Turn Wrapped Up: The current player has completed their turn!": Field,
    }

    @method initGame() { 
        super.init();
        
        this.player1Id.set(Field(0));
        this.player2Id.set(Field(0));
        //TODO change to turnCount
        this.turns.set(UInt8.from(0));
        
        this.targetRoot.set(Field(EMPTY_TREE8_ROOT));        
        this.hitRoot.set(EMPTY_TREE8_ROOT);
        this.serializedHitHistory.set(Field(0));
    }

    //TODO use generatePlayerID and fix notation
    @method hostGame(serializedBoard: Field, salt: Field) {
        // fetch the on-chain player1 ID
        const storedHostId = this.player1Id.getAndRequireEquals();
        
        /**
         * Assert that hostID is not updated yet.
         * !Make sure nobody tampers with the host ID once updated!
         */ 
        storedHostId.assertEquals(0, "This game has already a host!");

        // assert that board ship placements are valid
        const boardHash1 = BoardCircuit.validateBoard(serializedBoard);  

        // calculate host ID & store it on-chain
        const hostId = Poseidon.hash([boardHash1, ...this.sender.toFields(), salt]);
        this.player1Id.set(hostId);

        // emit event for successfully hosting a battleships game
        this.emitEvent("Game Hosted: A new Battleships game has been initiated!", hostId);
    }   
    
    //TODO use generatePlayerID and fix notation
    @method joinGame(serializedBoard2: Field, salt: Field) { 
        //TODO? check if the game is hosted
        //TODO? refer to each game to be joinable by a gameID

        // fetch on-chain player2 ID
        const storedJoinerId = this.player2Id.getAndRequireEquals();

        // assert that no one has already joined the game
        storedJoinerId.assertEquals(0, 'This game is already full!');

        // assert that joiner ships placement is valid
        const boardHash2 = BoardCircuit.validateBoard(serializedBoard2);  
        
        // calculate joiner ID & store it on-chain
        const joinerId = Poseidon.hash([boardHash2, ...this.sender.toFields(), salt]);
        this.player2Id.set(joinerId);

        // emit event for successfully joining a battleships game
        this.emitEvent("Player Joined: A new player has joined the hosted game!", joinerId);
    }

    /**
     * @notice proof verification is inherently reactive
     *         first target must be made to kick off the cycle
     */
    @method firstTurn(serializedTarget: Field, serializedBoard: Field, salt: Field, targetWitness: TargetMerkleWitness) {
        // fetch the on-chain turn counter and verify that it is the first turn
        const turns = this.turns.getAndRequireEquals();
        turns.assertEquals(0, "Opening attack can only be played at the beginning of the game!");

        // generate the sender's player ID
        const computedPlayerId = BoardUtils.generatePlayerId(serializedBoard, this.sender, salt);

        // fetch on-chain host ID 
        const storedHostId = this.player1Id.getAndRequireEquals();

        // restrict access to this method to the game's host
        computedPlayerId.assertEquals(storedHostId, 'Only the host is allowed to play the opening shot!')
        
        // validate that the target is in the game map range
        AttackUtils.validateTarget(serializedTarget);
        
        // store the target for the adversary to prove on his board in the next turn
        this.target.set(serializedTarget);

        // assert root index compliance with the turn counter
        targetWitness.calculateIndex().assertEquals(turns.value, "Target storage index is not compliant with turn counter!");
        
        /* 
        1. check that the address leaf is empty 
            --> prevent updating an already full target leaf
        2. check that the off-chain address storage is in sync
            --> a witness of an empty leaf(before update) maintains the same root(commitiment)
        */ 
        let currentTargetRoot = targetWitness.calculateRoot(Field(0));
        let storedTargetRoot = this.targetRoot.getAndRequireEquals();
        storedTargetRoot.assertEquals(currentTargetRoot, 'Off-chain target merkle tree is out of sync!');

        // calculate the new merkle root following the updated target root
        let updatedTargetRoot = targetWitness.calculateRoot(serializedTarget);

        // update the on-chain target Merkle Tree commitment(root)
        this.targetRoot.set(updatedTargetRoot);

        // increment the turn counter
        this.turns.set(turns.add(1));

        // emit event for successfully submitting the opening shot
        this.emitEvent("Game Started: The host has played the opening shot!", storedHostId);
    }

    @method attack(serializedTarget: Field, serializedBoard: Field, salt: Field, targetWitness: TargetMerkleWitness, hitWitness: HitMerkleWitness) { 
        let turns = this.turns.getAndRequireEquals();
        turns.assertGreaterThan(0, "Please wait for the host to play the opening shot first!")
        
        const isHost = turns.value.isEven();
        let player1Id = this.player1Id.getAndRequireEquals();
        let player2Id = this.player2Id.getAndRequireEquals();

        /**
         * - If the turn count is even then it's player1 turn.
         * - If the turn count is odd then it's player2 turn.
         * - NOTE: The host(player1) has the privilege to attack first.
         */
        let currentPlayerId = Provable.if(
            isHost, 
            player1Id,
            player2Id,
        );
        
        // fetch and deserialize the on-chain hitHistory
        const serializedHitHistory = this.serializedHitHistory.getAndRequireEquals();
        const [
            [player1HitCount, player2HitCount], 
            [player1HitTargets, player2HitTargets],
        ] = AttackUtils.deserializeHitHistory(serializedHitHistory);

        // check if there is a winner
        const isOver = player2HitCount.equals(17).or(player1HitCount.equals(17));
        
        // block game progress if there is a winner
        isOver.assertFalse(`Game is already over!`);

        // deserialize board, also referred as ships
        let deserializedBoard = BoardUtils.deserialize(serializedBoard);

        //TODO change order and refine error message
        // assert that the current player should be the sender
        let senderBoardHash = BoardUtils.hash(deserializedBoard);
        let senderId = Poseidon.hash([senderBoardHash, ...this.sender.toFields(), salt]);
        senderId.assertEquals(currentPlayerId, "You are not allowed to attack! Please wait for your adversary to take action!");

        // assert root index compliance with the turn counter
        const targetWitnessIndex = targetWitness.calculateIndex(); 
        targetWitnessIndex.assertEquals(turns.value, "Target storage index is not compliant with turn counter!");
        
        // assert hit witness index is in sync with the target merkle tree
        const hitWitnessIndex = hitWitness.calculateIndex();
        hitWitnessIndex.assertEquals(targetWitnessIndex.sub(1), "Hit storage index is not in sync with the target Merkle Tree");

        // validate target merkle root
        let currentTargetRoot = targetWitness.calculateRoot(Field(0));
        let storedTargetRoot = this.targetRoot.getAndRequireEquals();
        storedTargetRoot.assertEquals(currentTargetRoot, 'Off-chain target merkle tree is out of sync!');
        
        // validate hit merkle root
        let currentHitRoot = hitWitness.calculateRoot(Field(0));
        let storedHitRoot = this.hitRoot.getAndRequireEquals();
        storedHitRoot.assertEquals(currentHitRoot, 'Off-chain hit merkle tree is out of sync!');

        /**
         * 1. Fetch adversary's serialized target from previous turn.
         * 2. Deserialize target.
         * 3. Validate target and return hit result.
         */ 
        let adversarySerializedTarget = this.target.getAndRequireEquals();
        let adversaryTarget = AttackUtils.deserializeTarget(adversarySerializedTarget);
        let adversaryHitResult = AttackCircuit.attack(deserializedBoard, adversaryTarget);
        
        // update the on-chain hit result
        this.hitResult.set(adversaryHitResult);

        // update hit Merkle Tree root
        let updatedHitRoot = hitWitness.calculateRoot(adversaryHitResult.toField());
        this.hitRoot.set(updatedHitRoot);
        
        // update hit count history & serialize
        let updatedSerializedHitCountHistory = Provable.if(
            isHost, 
            AttackUtils.serializeHitCountHistory([player1HitCount, player2HitCount.add(adversaryHitResult.toField())]),
            AttackUtils.serializeHitCountHistory([player1HitCount.add(adversaryHitResult.toField()), player2HitCount]),
        );
        
        const playerTarget = AttackUtils.deserializeTarget(serializedTarget);
        let isNullified = Provable.if(
            isHost,
            AttackUtils.validateHitTargetUniqueness(playerTarget, player1HitTargets),
            AttackUtils.validateHitTargetUniqueness(playerTarget, player2HitTargets),
        );

        isNullified.assertFalse('Invalid Target! Please select a unique target!')

        let updatedSerializedHitTargetHistory = Provable.if(
            isHost,
            AttackUtils.serializeHitTargetHistory([player1HitTargets, AttackUtils.updateHitTargetHistory(adversaryTarget, adversaryHitResult, player2HitTargets, player2HitCount)]),
            AttackUtils.serializeHitTargetHistory([AttackUtils.updateHitTargetHistory(adversaryTarget, adversaryHitResult, player1HitTargets, player1HitCount), player2HitTargets]),
        );
        
        // update the on-chain hit history
        const updatedSerializedHitHistory = AttackUtils.serializeHitHistory(updatedSerializedHitCountHistory, updatedSerializedHitTargetHistory);
        this.serializedHitHistory.set(updatedSerializedHitHistory);
        
        //? validate & update the on-chain serialized target
        AttackUtils.validateTarget(serializedTarget);
        this.target.set(serializedTarget);

        // calculate target Merkle Tree root
        let updatedTargetRoot = targetWitness.calculateRoot(serializedTarget);

        // update the on-chain target Merkle Tree root on-chain
        this.targetRoot.set(updatedTargetRoot);

        // increment turn counter
        this.turns.set(turns.add(1));
        
        // emit event for successfully submitting a valid attack
        this.emitEvent("Turn Wrapped Up: The current player has completed their turn!", senderId);
    }
    
    @method finalizeGame() { return }
}

//TODO? Reset game when finished(keep state transition in mind)
//TODO have a last check on zkapp error handling & messages

