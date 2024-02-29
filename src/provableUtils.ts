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

    static decodeHitTarget(serializedTarget: Field) {
        const deserializedTarget = Provable.witness(Provable.Array(Field, 2), () => {
            let serialized = serializedTarget.toBigInt() - 1n;
            const x = serialized % 10n;
            const y = serialized / 10n;

            return [x, y].map(Field);
        });
        serializedTarget.assertEquals(AttackUtils.encodeHitTarget(deserializedTarget));

        return deserializedTarget
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

    static serializeHitCountHistory(hitHistory: Field[]) {
        const [player1HitCount, player2HitCount] = hitHistory;
        const player1HitCountBits = player1HitCount.toBits(5);
        const player2HitCountBits = player2HitCount.toBits(5);

        const serializedHitCountHistory = Field.fromBits([...player1HitCountBits, ...player2HitCountBits]);
        
        return serializedHitCountHistory
    }

    static serializeHitTargetHistory(hitTargetHistory: Field[][]) {
        const [player1HitTargets, player2HitTargets] = hitTargetHistory;
        const player1HitTargetBits = player1HitTargets.map(f => f.toBits(7)).flat();
        const player2HitTargetBits = player2HitTargets.map(f => f.toBits(7)).flat();

        const serializedHitTargetHistory = Field.fromBits([...player1HitTargetBits, ...player2HitTargetBits]);
        
        return serializedHitTargetHistory;
    }

    static serializeHitHistory(serializedHitCountHistory: Field, serializeHitTargetHistory: Field) { 
        const hitCountHistoryBits = serializedHitCountHistory.toBits(10);

        const hitTargetHistoryBits = serializeHitTargetHistory.toBits(238);

        const serializedHitHistory = Field.fromBits(
            [
                ...hitCountHistoryBits,
                ...hitTargetHistoryBits,
            ]);
        
        return serializedHitHistory
    }

    static deserializeHitHistory(serializedHitHistory: Field): [Field[], Field[][]] { 
        const bits = serializedHitHistory.toBits(248);

        const player1HitCount = Field.fromBits(bits.slice(0, 5));
        const player2HitCount = Field.fromBits(bits.slice(5, 10));

        const serializedPlayer1HitTargetHistory = Field.fromBits(bits.slice(10, 129));
        const serializedPlayer2HitTargetHistory = Field.fromBits(bits.slice(129, 248));

        // playerHitTargets array contains the serialized targets that landed a successful hit.
        const player1HitTargets = AttackUtils.deserializeHitTargetHistory(serializedPlayer1HitTargetHistory);
        const player2HitTargets = AttackUtils.deserializeHitTargetHistory(serializedPlayer2HitTargetHistory);

        return [
            [player1HitCount, player2HitCount], 
            [player1HitTargets, player2HitTargets],
        ];
    }

    /**
     * We encode data differently than serializeTarget to showcase an alternative approach and to conserve storage space.
     * 
     * When bitifying two numbers from 0 to 9 together, it typically requires 8 bits in total. However, by employing a technique
     * like bitifying 9 + 9*10 + 1, we reduce the storage requirement to 7 bits. This results in a total saving of 34 bits
     * because we store a maximum of 34 targets that land a successful hit.
     * 
     */
    static encodeHitTarget(hitTarget: Field[]) { 
        /**
         * Serialization is achieved by mapping a target [x, y] to a single field element: x + 10 * y + 1.
         * 
         * To distinguish encoded hit targets from initial values, we add one to the result. 
         * For example, if [0, 0] represents a target that successfully hits the adversary, 
         * serializing it would result in 0, which is indistinguishable from the initial value and prone to errors.
         * 
         * Therefore, we add one to the encoded value to avoid confusion and ensure proper differentiation.
         */
        const encodeHitTarget = hitTarget[0].add(hitTarget[1].mul(10)).add(1);
        return encodeHitTarget;
    }

    // returns an array of serialized hitTargets
    static deserializeHitTargetHistory(hitTargetHistory: Field) {
        const hitTargetHistoryBits = hitTargetHistory.toBits(119);
        let hitTargetsBits: Bool[][] = [];

        for (let i = 0; i < hitTargetHistoryBits.length; i += 7) {
            // Slice the original array into smaller arrays of length 7
            const parsedArray = hitTargetHistoryBits.slice(i, i + 7);
            // Push the parsed array into the parsedArrays array
            hitTargetsBits.push(parsedArray);
        }

        return hitTargetsBits.map(f => Field.fromBits(f));
    }

    //TODO validate before update
    //TODO should return field
    static updateHitTargetHistory(target: Field[], isHit: Bool, playerHitTargets: Field[], index: Field) {
        const encodedTarget = AttackUtils.encodeHitTarget(target);
        
        // Before encoding and storing a target, ensure it successfully hits its intended destination.
        // Otherwise take the encoded targetas init value = 0
        let encodedHitTarget = Provable.if(
            isHit,
            encodedTarget,
            Field(0),
        );
        
        const updatedPlayerHitTargets = Provable.witness(Provable.Array(Field, 17), () => {
            const hitTargetIndex = Number(index.toBigInt());
            
            // Modifying the function input could compromise the provability of the attack method.
            // To prevent this, we create a copy of the input array instead of directly modifying it.
            // This ensures that the attack method operates on a separate copy, preserving the integrity of the original input.
            let updated = [...playerHitTargets]
            updated[hitTargetIndex] = encodedHitTarget;
            
            return updated;
        });

        return updatedPlayerHitTargets
    }

    /**
     * Ensures a hit Target is not nullified for a given player.
     * 
     * A player should not be able to select a target that has already been hit in a previous turn.
     * Allowing such action would unfairly score points multiple times with the same target, compromising game fairness.
     * Missed targets are not stored as they do not affect the game state, making it illogical to select them.
     */
    static validateHitTargetUniqueness(target: Field[], hitTargetHistory: Field[]) {
        // We opt not to deserialize the hitTargetHistory to save computational resources.
        // Instead we serialize the target and then directly scan occurrences through an array of serialized targets. 
        // This approach conserves computational resources and enhances efficiency.
        let serializedTarget = AttackUtils.encodeHitTarget(target);
        let check = Provable.witness(Bool, () => {
            let isNullified = hitTargetHistory.some(item => item.equals(serializedTarget).toBoolean());
            return Bool(isNullified)
        });

        return check
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
