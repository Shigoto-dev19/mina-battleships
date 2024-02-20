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
} from './client.js'; 

export { 
    Battleships,
    TargetMerkleWitness,
    HitMerkleWitness, 
}

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

    @method initGame() { 
        super.init();
        
        this.player1Id.set(Field(0));
        this.player2Id.set(Field(0));
        this.turns.set(UInt8.from(0));

        const EMPTY_TREE8_ROOT = Field(14472842460125086645444909368571209079194991627904749620726822601198914470820n);

        // set target commitment as the root of an empty Merkle Tree of size 256
        this.targetRoot.set(Field(EMPTY_TREE8_ROOT));
        
        // set hit commitment as the root of an empty Merkle Tree of size 256
        this.hitRoot.set(EMPTY_TREE8_ROOT);
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

        this.targetRoot.getAndRequireEquals().assertEquals(currentTargetRoot, 'Off-chain target merkle tree is out of sync!');

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
        
        // deserialize board, also referred as ships
        let deserializedBoard = BoardUtils.deserialize(serializedBoard);
        
        // assert that the current player should be the sender
        let senderBoardHash = BoardUtils.hash(deserializedBoard);
        let senderId = Poseidon.hash([senderBoardHash, ...this.sender.toFields()]);
        senderId.assertEquals(currentPlayerId, "You are not allowed to attack!");

        /**
         * 1. Fetch adversary's serialized target from previous turn.
         * 2. Deserialize target.
         * 3. Validate target and return hit result.
         */ 
        let adversarySerializedTarget = this.target.getAndRequireEquals();
        let adversaryTarget = AttackUtils.deserializeTarget(adversarySerializedTarget);
        let hitResult = AttackCircuit.attack(deserializedBoard, adversaryTarget);
        
        //TODO field size storage doesn't change 
        // let hitHistory = this.hitHistory.getAndRequireEquals();
        //! toNumber() => not provable
        
        // let hitHistoryBits = hitHistory.toBits(turns.toNumber());
        // hitHistoryBits[turns.toNumber()] = hitResult;
        
        //TODO check if there is a winner

        // update hit history
        // hitHistory = Field.fromBits(hitHistoryBits);
        // this.hitHistory.set(hitHistory);

        // update the on-chain serialized target
        this.target.set(serializedTarget);

        // increment turn counter
        this.turns.set(turns.add(1));
    }
    
    @method finalizeGame() { return }
}

// Add merkle map for both shot and hit -> mapped together
// Add storage variable for hit1, hit2 and track winner --> emit event

//TODO Add winner check
//TODO Add merkle storage for target record 
//TODO - Complete game architecture
//TODO - Tests attack method 
//TODO - Add player client class
//TODO Reset game when finished

//TODO? Emit event following game actions

//? 1. Save adversary encrypted boards on-chain 
//? 2. encryption privateKey should only be knwon to the zkapp itself
//? 3. the key can be set after two players join 


// the order is very import for the index of the merkle treee
