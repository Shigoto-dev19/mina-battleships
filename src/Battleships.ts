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

    @method initGame() { 
        super.init();
        
        this.player1Id.set(Field(0));
        this.player2Id.set(Field(0));
        this.turns.set(UInt8.from(0));
        
        this.targetRoot.set(Field(EMPTY_TREE8_ROOT));        
        this.hitRoot.set(EMPTY_TREE8_ROOT);
        this.serializedHitHistory.set(Field(0));
    }

    @method hostGame(serializedBoard1: Field) {
        // fetch on-chain player1 ID
        const host = this.player1Id.getAndRequireEquals();
        
        /**
         * Assert that hostID is not updated yet.
         * !Make sure nobody tampers with the host ID once updated!
         */ 
        host.assertEquals(0, "This game has already a host!");

        // assert that host ships placement is valid
        const boardHash1 = BoardCircuit.validateBoard(serializedBoard1);  

        // calculate host ID & store it on-chain
        const hostId = Poseidon.hash([boardHash1, ...this.sender.toFields()]);
        this.player1Id.set(hostId);
    }   

    @method joinGame(serializedBoard2: Field) { 
        //TODO? check if the game is hosted
        //TODO? refer to each game to be joinable by a gameID

        // fetch on-chain player2 ID
        const joiner = this.player2Id.getAndRequireEquals();

        // assert that no one has already joined the game
        joiner.assertEquals(0, 'This game is already full!');

        // assert that joiner ships placement is valid
        const boardHash2 = BoardCircuit.validateBoard(serializedBoard2);  
        
        // calculate joiner ID & store it on-chain
        const joinerId = Poseidon.hash([boardHash2, ...this.sender.toFields()]);
        this.player2Id.set(joinerId);
    }

    /**
     * @notice proof verification is inherently reactive
     *         first target must be made to kick off the cycle
     */
    @method firstTurn(serializedTarget: Field, serializedBoard: Field, targetWitness: TargetMerkleWitness) {
        // fetch the on-chain turn counter and verify that it is the first turn
        const turns = this.turns.getAndRequireEquals();
        turns.assertEquals(0, "Opening attack can only be played at the beginning of the game!");

        // generate the sender's player ID
        const computedPlayerId = BoardUtils.generatePlayerId(serializedBoard, this.sender);

        // fetch on-chain host ID 
        const hostId = this.player1Id.getAndRequireEquals();

        // restrict access to this method to the game's host
        computedPlayerId.assertEquals(hostId, 'Only the host is allowed to play the opening shot!')
        
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
    }

    @method attack(serializedTarget: Field, serializedBoard: Field, targetWitness: TargetMerkleWitness, hitWitness: HitMerkleWitness) { 
        let turns = this.turns.getAndRequireEquals();
        turns.assertGreaterThan(0, "Please wait for the host to play the opening shot first!")
        
        let player1Id = this.player1Id.getAndRequireEquals();
        let player2Id = this.player2Id.getAndRequireEquals();

        /**
         * - If the turn count is even then it's player1 turn.
         * - If the turn count is odd then it's player2 turn.
         * - NOTE: The host(player1) has the privilege to attack first.
         */
        let currentPlayerId = Provable.if(
            turns.value.isEven(), 
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
        let senderId = Poseidon.hash([senderBoardHash, ...this.sender.toFields()]);
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
        
        //TODO Emit winner event

        // update the on-chain hit result
        this.hitResult.set(adversaryHitResult);

        // update hit Merkle Tree root
        let updatedHitRoot = hitWitness.calculateRoot(adversaryHitResult.toField());
        this.hitRoot.set(updatedHitRoot);
        
        // update hit count history & serialize
        let updatedSerializedHitCountHistory = Provable.if(
            turns.value.isEven(), 
            AttackUtils.serializeHitCountHistory([player1HitCount, player2HitCount.add(adversaryHitResult.toField())]),
            AttackUtils.serializeHitCountHistory([player1HitCount.add(adversaryHitResult.toField()), player2HitCount]),
        );
        
        const playerTarget = AttackUtils.deserializeTarget(serializedTarget);
        let isNullifiedCheck = Provable.if(
            turns.value.isEven(),
            AttackUtils.validateHitTargetUniqueness(playerTarget, player1HitTargets),
            AttackUtils.validateHitTargetUniqueness(playerTarget, player2HitTargets),
        );

        isNullifiedCheck.assertFalse('Please select a unique target!')

        let updatedSerializedHitTargetHistory = Provable.if(
            turns.value.isEven(),
            AttackUtils.serializeHitTargetHistory([player1HitTargets, AttackUtils.updateHitTargetHistory(adversaryTarget, adversaryHitResult, player2HitTargets, player2HitCount)]),
            AttackUtils.serializeHitTargetHistory([AttackUtils.updateHitTargetHistory(adversaryTarget, adversaryHitResult, player1HitTargets, player1HitCount), player2HitTargets]),
        );
        //TODO check target uniqueness -> ok!
        //TODO update hitHistory -> ok!
        //TODO update hit target -> ok!
        //TODO should serialize the same target and add one 
        //? update the on-chain hitHistory
        
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
    }
    
    @method finalizeGame() { return }
}

//TODO Reset game when finished(keep state transition in mind)
//TODO Add nullifer for target to prevent player for attacking the same target more than once 
//TODO Add salt when generating player ID --> we want player to be able to reuse same board without generating the same ID  

//TODO? Emit event following game actions

//? 1. Save adversary encrypted boards on-chain 
//? 2. encryption privateKey should only be knwon to the zkapp itself
//? 3. the key can be set after two players join 

//TODO in the target serialized --> proivde bits to store hit target --> we need to prevent a player from hitting the same target and keep claiming hits?
//TODO --> the good thing we will only prevent the player from hitting hit target and the missed ones won't affect the game
//TODO --> better than nullifier semantics 
//TODO --> add one after serialized to distinguish value from initial value
//TODO have a last check on zkapp error handling & messages
//TODO have consistent serialization for target
