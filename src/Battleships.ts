import { 
    Field, 
    Bool,
    PublicKey,
    UInt8,
    state, 
    State,
    method,
    SmartContract, 
    Struct,
    Provable,
    PrivateKey,
} from 'o1js';

import { AttackCircuit, BoardCircuit, BoardUtils } from './client.js'; 

export { Battleships }

class Player extends Struct({ address: PublicKey, boardHash: Field }) {
    address: PublicKey;
    boardHash: Field;

    constructor(player: {address: PublicKey, boardHash: Field}) {
        super(player);
        this.address = player.address;
        this.boardHash = player.boardHash;
    }

    static pending() { 
        return new Player({ 
            address: PublicKey.empty(),
            boardHash: Field(0),
        });
    }

    toFields() {
        return Player.toFields(this);
    }
}

class Battleships extends SmartContract { 
    @state(Bool) joinable = State<Bool>();
    @state(Bool) finished = State<Bool>();
    @state(Player) player1 = State<Player>();
    @state(Player) player2 = State<Player>();
    @state(UInt8) turns = State<UInt8>();
    @state(Field) target = State<Field>();
    @state(Field) hitHistory = State<Field>();

    init() { 
        super.init();
        this.joinable.set(Bool(true));
        this.finished.set(Bool(false));
        this.player1.set(Player.pending());
        this.player2.set(Player.pending());
        this.turns.set(UInt8.from(0));
        this.hitHistory.set(Field(0));
    }

    @method hostGame(serializedBoard1: Field) {
        const boardHash1 = BoardCircuit.validateBoard(serializedBoard1);  
        this.player1.set(new Player({
            address: this.sender,
            boardHash: boardHash1,
        }));
    }

    @method joinGame(serializedBoard2: Field) { 
        this.joinable.getAndRequireEquals().assertTrue('This game is already full!');

        const boardHash2 = BoardCircuit.validateBoard(serializedBoard2);  
        this.player2.set(new Player({
            address: this.sender,
            boardHash: boardHash2,
        }));
    
        this.joinable.set(Bool(false));
    }

    @method firstTurn(target: Field) {
        const turns = this.turns.getAndRequireEquals();
        turns.assertEquals(0, "Opening attack can only be played at the beginning of the game!");
        
        // store the target for the adversary to prove on his board
        this.target.set(target);

        // incremnt turn counter
        this.turns.set(turns.add(1));
    }

    //TODO store hit history on-chain as a Field.fromBits()
    //TODO serialize target to be represented as a single field element
    @method attack(target: Field, serializeBoard: Field) { 
        let turns = this.turns.getAndRequireEquals();
        turns.assertGreaterThan(0, "Host should play the opening shot first!")
        
        let player1 = this.player1.getAndRequireEquals();
        let player2 = this.player2.getAndRequireEquals();
        
        const assertPlayerTurn = (player: Player) => {
            this.sender.assertEquals(player.address);
            return player;
        }

        /**
         * - If the turn count is even then it's player1 turn.
         * - If the turn count is odd then it's player2 turn.
         * - NOTE: The host(player1) has the privilege to attack first.
         */
        let currentPlayer = Provable.if(
            turns.value.isEven(), 
            assertPlayerTurn(player1),
            assertPlayerTurn(player2),
        );
        
        // Also referred as ships
        let deserializedBoard = BoardUtils.deserialize(serializeBoard);

        let computedPlayerBoardHash = BoardUtils.hash(deserializedBoard);
        let currentPlayerBoardHash = currentPlayer.boardHash;
        currentPlayerBoardHash.assertEquals(computedPlayerBoardHash, "Board hash integrity check failed!");

        // fetch adversary's target from previous turn
        let adversaryTarget = this.target.getAndRequireEquals();
        let hitResult = AttackCircuit.attack(deserializedBoard, [adversaryTarget]);
        
        //TODO Update hit history on-chain
        let hitHistory = this.hitHistory.getAndRequireEquals();

        // update the on-chain target
        this.target.set(target);

        // increment turn counter
        this.turns.set(turns.add(1));
    }

    @method finalizeGame() { return }
}

import { Encryption } from 'o1js'

const privateKey = PrivateKey.random();
const otherPublicKey = privateKey.toPublicKey();
const plaintext = Field(123456789);
let ciphertext = Encryption.encrypt([plaintext], otherPublicKey);
Provable.log('ciphertext: ', ciphertext);


let decrypted = Encryption.decrypt(ciphertext, privateKey);
Provable.log('plaintext: ', decrypted);


//TODO Complete game architecture
//TODO Add player client class
//TODO Reset game when finished
//TODO Add winner check

//TODO? Emit event following game actions

//? 1. Save adversary encrypted boards on-chain 
//? 2. encryption privateKey should only be knwon to the zkapp itself
//? 3. the key can be set after two players join 
