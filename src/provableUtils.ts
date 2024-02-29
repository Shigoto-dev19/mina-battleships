import { 
    Field, 
    Bool,
    Poseidon,
    Provable,
    PublicKey,
} from 'o1js';

export { 
    BoardUtils, 
    BoardCircuit,
    AttackUtils,
    AttackCircuit,
}

class BoardUtils {
    //TODO refactor
    static serialize(board: number[][]) { 
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

    static deserialize(serializedBoard: Field) { 
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
        return Poseidon.hash(board.flat());
    }  

    static hashSerialized(serializedBoard: Field) { 
        const deserializedBoard = BoardUtils.deserialize(serializedBoard);
        return BoardUtils.hash(deserializedBoard);
    }

    static generatePlayerId(serializedBoard: Field, playerAddress: PublicKey) {
        const boardHash = BoardUtils.hashSerialized(serializedBoard);
        return Poseidon.hash([boardHash, ...playerAddress.toFields()]);
    }
}

class BoardCircuit { 
    static validateShipInRange(ship: Field[], shipLength: number, errorMessage: string) { 
        // horizontal check: z=ship[2]=0 
        const checkHorizontal = () => {
            const hCheck = ship[0].add(shipLength - 1).lessThan(10);
            const vCheck = ship[1].lessThan(10);
            return hCheck.and(vCheck)
        }
        
        // vertical check: z=ship[2]=1
        const checkVertical = () => { 
            const hCheck = ship[0].lessThan(10);
            const vCheck = ship[1].add(shipLength - 1).lessThan(10);
            return hCheck.and(vCheck)
        }

        // verify z is binary
        //TODO infer which adding another argument for zErrorMessage 
        ship[2].assertLessThanOrEqual(1, 'Coordinate z should be 1 or 0!');

        const isInRange = Provable.if(ship[2].equals(1), checkVertical(), checkHorizontal());
        isInRange.assertTrue(errorMessage);
    }

    static placeShip(ship: Field[], shipLength: number, boardMap: Field[], errorMessage: string) { 
        const increment = Provable.if(ship[2].equals(1), Field(10), Field(1));
        let index = ship[0].add(ship[1].mul(10));
        let coordinate = index;
        for(let i=0; i<shipLength; i++) {
            if (i === 0) coordinate;
            else coordinate = index.add(Field(i).mul(increment));
            let check = Provable.witness(Bool, () => {
                let collisionExists = boardMap.some(item => item.equals(coordinate).toBoolean());
                return Bool(collisionExists)
            });
            check.assertFalse(errorMessage); 
            boardMap.push(coordinate);
        }
        return boardMap
    }

    static validateShipsLocation(ships: Field[][]) {
        const shipLengths = [5, 4, 3, 3, 2];
        let boardMap: Field[] = [];
        for (let i = 0; i < 5; i++) {
            // range check
            BoardCircuit.validateShipInRange(ships[i], shipLengths[i], `Invalid Board! Ship${i+1} is out of board range!`);
            // collision check
            boardMap = BoardCircuit.placeShip(ships[i], shipLengths[i], boardMap,`Invalid Board! Collision occured when placing Ship${i+1}!`);
        }
    }

    static validateBoard(serializedBoard: Field) { 
        const board = BoardUtils.deserialize(serializedBoard);
        this.validateShipsLocation(board);
        const boardHash = BoardUtils.hash(board);
        
        return boardHash
    }
}

class AttackUtils { 
    static serializeTarget(target: number[]) { 
        const parsedTarget = AttackUtils.parseTarget(target);

        const xBits = parsedTarget[0].toBits(4);
        const yBits = parsedTarget[1].toBits(4);
        const serializedTarget = Field.fromBits([...xBits, ...yBits]);

        return serializedTarget
    }

    static deserializeTarget(serializedTarget: Field) { 
        const bits = serializedTarget.toBits(8);
        const targetX = Field.fromBits(bits.slice(0, 4));
        const targetY = Field.fromBits(bits.slice(4, 8));

        return [targetX, targetY];
    }

    static validateTarget(serializedTarget: Field) { 
        // validate that the target is in the game map range
        const target = AttackUtils.deserializeTarget(serializedTarget);
        target[0].assertLessThan(10, 'Target x coordinate is out of bound!');
        target[1].assertLessThan(10, 'Target y coordinate is out of bound!');
    }

    static parseTarget(target: number[]) {
        return target.map(Field);
    }

    static serializeHitHistory(hitHistory: Field[]) { 
        const [player1HitCount, player2HitCount] = hitHistory;
        const player1HitCountBits = player1HitCount.toBits(5);
        const player2HitCountBits = player2HitCount.toBits(5);
        const serializedHitHistory = Field.fromBits([...player1HitCountBits, ...player2HitCountBits]);
       
        return serializedHitHistory
    }

    static deserializeHitHistory(serializedHitHistory: Field) { 
        const bits = serializedHitHistory.toBits(10);
        const player1HitCount = Field.fromBits(bits.slice(0, 5));
        const player2HitCount = Field.fromBits(bits.slice(5, 10));

        return [player1HitCount, player2HitCount];
    }
}

class AttackCircuit {
    /*
    Determine whether or not a given ship is hit by a given shot x/y coordinate pair
    */
    static scanShip(shot: Field[], ship: Field[], shipLength: number) { 
        // return hit result for a horizontal ship
        const hitHorizontalShip = () => {
            let xHit = Bool(false);
            let yHit = Bool(false);
            for (let i = 0; i < shipLength; i++) {
                xHit = xHit.or(ship[0].add(i).equals(shot[0]));
                yHit = yHit.or(ship[1].equals(shot[1]));
            }
            return xHit.and(yHit);
        }
        
        // return hit result for a vertical ship
        const hitVerticalShip = () => {
            let xHit = Bool(false);
            let yHit = Bool(false);
            for (let i = 0; i < shipLength; i++) {
                xHit = xHit.or(ship[0].equals(shot[0]));
                yHit = yHit.or(ship[1].add(i).equals(shot[1]));
            }
            return xHit.and(yHit);
        }

        // true if hit, 0 if missed
        const hitResult = Provable.if(ship[2].equals(1), hitVerticalShip(), hitHorizontalShip());
        return hitResult
    }

    /*
    determine whether or not a shot hit a given board arrangement
    proving whether a given coordinate pair hits a ship placement
    !assert board hash integrity before
    */
    static attack(ships: Field[][], shot: Field[]) { 
        // assert that shot is in board range
        shot[0].assertLessThan(10, 'Target x coordinate is out of bound!');
        shot[1].assertLessThan(10, 'Target y coordinate is out of bound!');

        // scan hit for all ships
        const shipLengths = [5, 4, 3, 3, 2];
        let hit = Bool(false);
        for (let i=0; i<5; i++) {
            hit = hit.or(AttackCircuit.scanShip(shot, ships[i], shipLengths[i]));
        }

        return hit;
    }
}