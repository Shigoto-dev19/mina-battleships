import { 
    Field, 
    Bool,
    Poseidon,
    Provable,
} from 'o1js';

export { BoardUtils, BoardCircuit }

class BoardUtils {
    //TODO refactor
    static serializeBoard(board: number[][]) { 
        let serializedCoordinates: Bool[][][] = [];
        for (const shipCoordinates of board) { 
            let x = Field(shipCoordinates[0]).toBits(8);
            let y = Field(shipCoordinates[1]).toBits(8);
            let z = Field(shipCoordinates[2]).toBits(8);
            serializedCoordinates.push([x, y, z]);
        }
        // the serialized board is 24 * 5 = 120 bit-field
        const serializedBoard = Field.fromBits(serializedCoordinates.flat().flat());
        return serializedBoard
    }

    static deserializeBoard(serializedBoard: Field) { 
        const splitArrayIntoGroups= <T>(array: T[], groupSize: number): T[][] => { 
            let result: T[][] = [];
            for (let i = 0; i < array.length; i += groupSize) {
            result.push(array.slice(i, i + groupSize));
          }
          return result
        }

        let bits = serializedBoard.toBits(120);
        let serializedCoordinates = splitArrayIntoGroups(bits, 8).map(f => Field.fromBits(f));
        let board = splitArrayIntoGroups(serializedCoordinates, 3);

        return board
    }
    static parse(board: number[][]) { 
        return board.map((ship) => ship.map(Field))
    } 

    static hash(board: Field[][]) { 
        return  Poseidon.hash(board.flat());
    }  
}

class BoardCircuit { 
    static validateShipInRange(ship: Field[], shipLength: number, errorMessage: string) { 
        // horizontal check: z=ship[2]=0 
        const checkHorizontal = () => {
            const hCheck = ship[0].add(shipLength).lessThan(10);
            const vCheck = ship[1].lessThan(10);
            return hCheck.and(vCheck)
        }
        
        // vertical check: z=ship[2]=1
        const checkVertical = () => { 
            const hCheck = ship[0].lessThan(10);
            const vCheck = ship[1].add(shipLength).lessThan(10);
            return hCheck.and(vCheck)
        }

        // verify z is binary
        ship[2].assertLessThanOrEqual(1, 'Coordinate z should be 1 or 0!');

        const isInRange = Provable.if(ship[2].equals(1), checkVertical(), checkHorizontal());
        isInRange.assertTrue(errorMessage);
    }

    static placeShip(ship: Field[], shipLength: number, boardMap: Field[], errorMessage: string) { 
        const increment = Provable.if(ship[2].equals(1), Field(10), Field(0));
        let index = ship[0].add(ship[1].mul(10));
        for(let i=0; i<shipLength; i++) {
            let coordinate = index.add(i).add(increment);
            let check = boardMap.some(item => item.equals(coordinate).toBoolean());
            // Provable.log('check: ', check)
            Bool(check).assertFalse(errorMessage);
            boardMap.push(coordinate);
        }
        return boardMap
    }

    static validateShipsLocation(ships: Field[][]) {
        const shipLength = [5, 4, 3, 3, 2];
        let boardMap: Field[] = [];
        for (let i = 0; i < 5; i++) {
            // range check
            BoardCircuit.validateShipInRange(ships[i], shipLength[i], `Ship${i+1} is out of board range!`);
            // collision check
            boardMap = BoardCircuit.placeShip(ships[i], shipLength[i], boardMap,`Collision occured when placing Ship${i+1}!`);
        }
    }

    static validateBoard(serializedBoard: Field) { 
        const board = BoardUtils.deserializeBoard(serializedBoard);
        this.validateShipsLocation(board);
        const boardHash = BoardUtils.hash(board);
        
        return boardHash
    }
}

// const player1Board = [
//     [0, 1, 0],
//     [0, 1, 0],
//     [0, 2, 0],
//     [0, 3, 0],
//     [0, 4, 0],
// ];

// const serializedBoard = BoardUtils.serializeBoard(player1Board);
// let deserializeBoard = BoardUtils.deserializeBoard(serializedBoard).flat().map(x => Number(x.toBigInt()));

// console.log('initial board: ', player1Board.flat());
// console.log('deserialized board: ', deserializeBoard);

// //TODO Add board integration tests 
// //TODO? confirm board circuit is provable

// console.time('board witness');
// Provable.runAndCheck(() => {
//     BoardCircuit.validateShipsLocation(player1Board.map(ship => ship.map(Field)))
// });
// console.timeEnd('board witness');