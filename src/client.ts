import { 
    Field, 
    Bool,
    Poseidon,
} from 'o1js';

export { Client }

class Client {
    board: number[][];
    boardHash?: Field = undefined;
    serializedBoard: Field;
    
    constructor(board: number[][]) { 
        this.board = board;
    }

    //TODO refactor
    serializeBoard() { 
        let serializedCoordinates: Bool[][][] = [];
        for (const shipCoordinates of this.board) { 
            let x = Field(shipCoordinates[0]).toBits(8);
            let y = Field(shipCoordinates[1]).toBits(8);
            let z = Field(shipCoordinates[2]).toBits(8);
            serializedCoordinates.push([x, y, z]);
        }
        // the serialized board is 24 * 5 = 120 bit-field
        this.serializedBoard = Field.fromBits(serializedCoordinates.flat().flat())
    }

    deserializeBoard() { 
        const splitArrayIntoGroups= <T>(array: T[], groupSize: number): T[][] => { 
            let result: T[][] = [];
            for (let i = 0; i < array.length; i += groupSize) {
            result.push(array.slice(i, i + groupSize));
          }
          return result
        }

        let bits = this.serializedBoard.toBits(120);
        let serializedCoordinates = splitArrayIntoGroups(bits, 8).map(f => Field.fromBits(f));
        let board = splitArrayIntoGroups(serializedCoordinates, 3);

        return board
    }

    hashBoard() { 
        this.boardHash = this.boardHash ?? Poseidon.hash([this.serializedBoard]);
    }  

    validateBoard() { 
        //TODO 1. deserialize board
        //TODO 2. check ships non-collision
        //TODO 3. check ships in board range  
        //TODO 4. assert board hash compliance
        return  
    }
}

const player1Board = [
    [0, 0, 0],
    [0, 1, 0],
    [0, 2, 0],
    [0, 3, 0],
    [0, 4, 0],
];

let player = new Client(player1Board);
player.serializeBoard();
let board = player.deserializeBoard().flat().map(x => Number(x.toBigInt()));

console.log('initial board: ', player1Board.flat());
console.log('deserialized board: ', board);

//TODO Finsih board circuit
//TODO Update contract
//TODO Add board integration tests 
