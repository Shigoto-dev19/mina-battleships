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
    Poseidon,
} from 'o1js';

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
        const boardHash = Poseidon.hash([serializedBoard1]);  
        //TODO deserializeBoard(serializedBoard1);
        //TODO validateBoard();

        this.player1.set({
            address: this.sender,
            boardHash,
        });
    }

    @method joinGame(serializedBoard2: Field) { 
        const boardHash = Poseidon.hash([serializedBoard2]);
        //TODO deserializeBoard(serializedBoard1);
        //TODO validateBoard();

        this.player2.set({
            address: this.sender,
            boardHash
        });

        this.joinable.set(Bool(false));
    }

    @method attack() { return }

    @method finalizeGame() { return }
}

//TODO Add player client class
