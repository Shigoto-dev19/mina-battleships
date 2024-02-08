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
} from 'o1js';
import { BoardCircuit } from './client'; 

export { Battleships }

class Player extends Struct({ address: PublicKey, boardHash: Field }) {
    address: PublicKey;
    static pending() { 
        return { 
            address: PublicKey.empty(),
            boardHash: Field(0),
        }
    }
}

class Battleships extends SmartContract { 
    @state(Bool) joinable = State<Bool>();
    @state(Bool) finished = State<Bool>();
    @state(Player) player1 = State<Player>();
    @state(Player) player2 = State<Player>();
    @state(UInt8) turns = State<UInt8>();

    init() { 
        super.init();
        this.joinable.set(Bool(true));
        this.finished.set(Bool(false));
        this.player1.set(Player.pending());
        this.player2.set(Player.pending());
        this.turns.set(UInt8.from(0));
    }

    @method hostGame(serializedBoard1: Field) {
        const boardHash1 = BoardCircuit.validateBoard(serializedBoard1);  
        this.player1.set({
            address: this.sender,
            boardHash: boardHash1,
        });
    }

    @method joinGame(serializedBoard2: Field) { 
        const boardHash2 = BoardCircuit.validateBoard(serializedBoard2);  
        this.player2.set({
            address: this.sender,
            boardHash: boardHash2,
        });

        this.joinable.set(Bool(false));
    }

    @method attack() { return }

    @method finalizeGame() { return }
}

//TODO Test attack circuit
//TODO Add player client class
//? 1. Save adversary encrypted boards on-chain 
//? 2. encryption privateKey should only be knwon to the zkapp itself
//? 3. the key can be set after two players join 
