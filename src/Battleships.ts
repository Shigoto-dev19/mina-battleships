import { 
    Field, 
    Bool,
    UInt8,
    state, 
    State,
    method,
    SmartContract, 
    Provable,
    Poseidon,
} from 'o1js';

import { 
    BoardUtils,
    BoardCircuit, 
    AttackUtils,
    AttackCircuit, 
} from './client.js'; 

export { Battleships }

class Battleships extends SmartContract { 
    @state(Bool) joinable = State<Bool>();
    @state(Bool) finished = State<Bool>();
    @state(Field) player1Id = State<Field>();
    @state(Field) player2Id = State<Field>();
    @state(UInt8) turns = State<UInt8>();
    @state(Field) target = State<Field>();
    @state(Field) hitHistory = State<Field>();

    initGame() { 
        super.init();
        this.joinable.set(Bool(true));
        this.finished.set(Bool(false));
        this.player1Id.set(Field(0));
        this.player2Id.set(Field(0));
        this.turns.set(UInt8.from(0));
        this.hitHistory.set(Field(0));
    }

    @method hostGame(serializedBoard1: Field) {
        const boardHash1 = BoardCircuit.validateBoard(serializedBoard1);  
        const hostId = Poseidon.hash([boardHash1, ...this.sender.toFields()]);
        this.player1Id.set(hostId);
    }   

    @method joinGame(serializedBoard2: Field) { 
        this.joinable.getAndRequireEquals().assertTrue('This game is already full!');
        const boardHash2 = BoardCircuit.validateBoard(serializedBoard2);  
        const joinerId = Poseidon.hash([boardHash2, ...this.sender.toFields()]);

        this.player2Id.set(joinerId);
        
        // set joinable to false to prevent calling this method 
        this.joinable.set(Bool(false));
    }

    @method firstTurn(target: Field) {
        const turns = this.turns.getAndRequireEquals();
        turns.assertEquals(0, "Opening attack can only be played at the beginning of the game!");
        
        // store the target for the adversary to prove on his board in the next turn
        this.target.set(target);

        // increment turn counter
        this.turns.set(turns.add(1));
    }

    @method attack(serializedTarget: Field, serializedBoard: Field) { 
        let turns = this.turns.getAndRequireEquals();
        turns.assertGreaterThan(0, "Host should play the opening shot first!")
        
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
        
        let hitHistory = this.hitHistory.getAndRequireEquals();
        //! toNumber() => not provable
        let hitHistoryBits = hitHistory.toBits(turns.toNumber());
        hitHistoryBits[turns.toNumber()] = hitResult;
        
        //TODO check if there is a winner

        // update hit history
        hitHistory = Field.fromBits(hitHistoryBits);
        this.hitHistory.set(hitHistory);

        // update the on-chain serialized target
        this.target.set(serializedTarget);

        // increment turn counter
        this.turns.set(turns.add(1));
    }

    @method finalizeGame() { return }
}

//TODO Add winner check
//TODO Complete game architecture
//TODO Add player client class
//TODO Reset game when finished

//TODO Track joinability following turn counter
//TODO hash player address + board hash

//TODO? Emit event following game actions

//? 1. Save adversary encrypted boards on-chain 
//? 2. encryption privateKey should only be knwon to the zkapp itself
//? 3. the key can be set after two players join 
