/**
 * This file contains both provable functions and utilities/helpers for the Battleships zkapp, 
 * serving both functional and testing purposes.
 * 
 * In this context:
 * - Circuits refer to provable code directly utilized within the Battleships zkapp.
 * - Utils denote utilities and helpers responsible for parsing inputs or providing 
 *   provable building blocks for a circuit.
 */

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
    /**
     * Serialize the given battleships configuration.
     * @param {number[][]} board - An array of ship configurations, where each ship is represented as [x, y, z] coordinates:
     *                             x = x coordinate on the board
     *                             y = y coordinate on the board
     *                             z = orientation (0=horizontal, 1=vertical)
     * @returns {Field} The serialized representation of the battleships board.
     */
    static serialize(board: number[][]) { 
        let serializedCoordinates: Bool[][][] = [];
        for (const shipCoordinates of board) { 
            let x = Field(shipCoordinates[0]).toBits(8);
            let y = Field(shipCoordinates[1]).toBits(8);
            let z = Field(shipCoordinates[2]).toBits(8);
            serializedCoordinates.push([x, y, z]);
        }
        // The serialized board is a 120-bit field (24 * 5).
        const serializedBoard = Field.fromBits(serializedCoordinates.flat().flat());
        
        return serializedBoard;
    }

    /**
     * Deserialize the given serialized battleships board.
     * @param {Field} serializedBoard - The serialized representation of the battleships board.
     * @returns {number[][]} An array of ship configurations, where each ship is represented as [x, y, z] coordinates:
     *                        x = x coordinate on the board
     *                        y = y coordinate on the board
     *                        z = orientation (0=horizontal, 1=vertical)
     */
    static deserialize(serializedBoard: Field) { 
        // Split an array into groups of a specified size.
        const splitArrayIntoGroups= <T>(array: T[], groupSize: number): T[][] => { 
            let result: T[][] = [];
            for (let i = 0; i < array.length; i += groupSize) {
                result.push(array.slice(i, i + groupSize));
            }
            return result;
        };

        // Convert serialized board to an array of bits
        let bits = serializedBoard.toBits(120);

        // Convert bits into serialized coordinates (x, y, z)
        let serializedCoordinates = splitArrayIntoGroups(bits, 8).map(f => Field.fromBits(f));

        // Split serialized coordinates into ship configurations (x, y, z) groups
        let board = splitArrayIntoGroups(serializedCoordinates, 3);

        return board;
    }

    /**
     * Parse the given battleships board by converting each ship's coordinates to Field elements.
     * @param {number[][]} board - The battleships board to parse.
     * @returns {Field[][]} The parsed battleships board where each ship's coordinates are represented as Field elements.
     */
    static parse(board: number[][]) { 
        return board.map((ship) => ship.map(Field));
    } 

    /**
     * Calculate the poseidon hash of the given battleships board represented as Field elements.
     * @param {Field[][]} board - The battleships board represented as Field elements.
     * @returns {Field} The hash of the battleships board.
     */
    static hash(board: Field[][]) { 
        return Poseidon.hash(board.flat());
    }  

    /**
     * Calculate the hash of the serialized battleships board.
     * @param {Field} serializedBoard - The serialized representation of the battleships board.
     * @returns {Field} The hash of the serialized battleships board.
     */
    static hashSerialized(serializedBoard: Field) { 
        const deserializedBoard = BoardUtils.deserialize(serializedBoard);
        return BoardUtils.hash(deserializedBoard);
    }

    /**
     * Generate a player ID based on the serialized battleships board, player address, and salt.
     * @param {Field} serializedBoard - The serialized representation of the battleships board.
     * @param {PublicKey} playerAddress - The address of the player.
     * @param {Field} salt - The salt value used for generating the player ID.
     * @returns {Field} The generated player ID.
     */
    static generatePlayerId(serializedBoard: Field, playerAddress: PublicKey, salt: Field) {
        const boardHash = BoardUtils.hashSerialized(serializedBoard);
        return Poseidon.hash([boardHash, ...playerAddress.toFields(), salt]);
    }
}

class BoardCircuit { 
    /**
     * Validate that the ship is within the bounds of the battleships grid.
     * @param {Field[]} ship - The coordinates of the ship represented as Field elements.
     * @param {number} shipLength - The length of the ship.
     * @param {string} errorMessage - The error message to display if the ship is out of range.
     */
    static validateShipInRange(ship: Field[], shipLength: number, errorMessage: string) { 
        // Horizontal check: z=ship[2]=0 
        const checkHorizontal = () => {
            const hCheck = ship[0].add(shipLength - 1).lessThan(10);
            const vCheck = ship[1].lessThan(10);
            return hCheck.and(vCheck);
        };
        
        // Vertical check: z=ship[2]=1
        const checkVertical = () => { 
            const hCheck = ship[0].lessThan(10);
            const vCheck = ship[1].add(shipLength - 1).lessThan(10);
            return hCheck.and(vCheck);
        };

        // Verify z is binary
        ship[2].assertLessThanOrEqual(1, 'Coordinate z should be 1 or 0!');

        // Perform the appropriate range check based on the orientation of the ship
        const isInRange = Provable.if(ship[2].equals(1), checkVertical(), checkHorizontal());
        
        // Assert that the ship is within range, otherwise display the error message
        isInRange.assertTrue(errorMessage);
    }

    /**
     * Place the ship on the battleships board and validate that there are no collisions.
     * @param {Field[]} ship - The coordinates of the ship represented as Field objects.
     * @param {number} shipLength - The length of the ship.
     * @param {Field[]} boardMap - The map of the battleships grid.
     * @param {string} errorMessage - The error message to display if there is a collision.
     * @returns {Field[]} The updated map of the battleships board after placing the ship.
     */
    static placeShip(ship: Field[], shipLength: number, boardMap: Field[], errorMessage: string) { 
        // Determine the increment value based on the orientation of the ship
        const increment = Provable.if(ship[2].equals(1), Field(10), Field(1));
        
        const location = ship[0].add(ship[1].mul(10));
        let coordinate = location;
        for(let i=0; i<shipLength; i++) {
            if (i === 0) coordinate;
            else coordinate = location.add(Field(i).mul(increment));
            // Check for collision at the current coordinate
            const collisionExists = Provable.witness(Bool, () => {
                const collisionOccurence = boardMap.some(item => item.equals(coordinate).toBoolean());
                return Bool(collisionOccurence);
            });

            // Assert that there is no collision, otherwise display the error message
            collisionExists.assertFalse(errorMessage); 
            
            // Add the coordinate to the board map
            boardMap.push(coordinate);
        }

        // Return the updated board map
        return boardMap;
    }

    /**
     * Validate the locations of all ships on the battleships map.
     * @param {Field[][]} ships - The coordinates of all ships represented as 2D array of Field elements.
     */
    static validateShipsLocation(ships: Field[][]) {
        // Define the lengths of each ship
        const shipLengths = [5, 4, 3, 3, 2];
        
        let boardMap: Field[] = [];
        for (let i = 0; i < 5; i++) {
            // Perform range check for the current ship
            let rangeErrorMessage = `Invalid Board! Ship${i+1} is out of board range!`;
            BoardCircuit.validateShipInRange(ships[i], shipLengths[i], rangeErrorMessage);
            
            // Perform collision check and place the ship on the board
            let collisionErrorMessage = `Invalid Board! Collision occurred when placing Ship${i+1}!`;
            boardMap = BoardCircuit.placeShip(ships[i], shipLengths[i], boardMap, collisionErrorMessage);
        }
    }

    /**
     * Validate the battleships board represented by the serialized board.
     * @param {Field} serializedBoard - The serialized representation of the battleships board.
     * @returns {Field} The hash of the validated battleships board.
     */
    static validateBoard(serializedBoard: Field) { 
        // Deserialize the serialized board to obtain the board configuration
        const board = BoardUtils.deserialize(serializedBoard);
        // Validate the locations of all ships on the board
        this.validateShipsLocation(board);
        // Calculate the hash of the validated board
        const boardHash = BoardUtils.hash(board);
        
        return boardHash;
    }
}

class AttackUtils { 
    /**
     * Parse a target coordinate pair into Field elements.
     * @param {number[]} target - The x/y coordinate pair representing the target.
     * @returns {Field[]} The parsed target coordinates as Field elements.
     */
    static parseTarget(target: number[]) {
        return target.map(Field);
    }

    /**
     * Serialize a target coordinate pair for attacking.
     * @param {number[]} target - The x/y coordinate pair representing the target.
     * @returns {Field} The serialized target as a Field element.
     */
    static serializeTarget(target: number[]) { 
        const parsedTarget = AttackUtils.parseTarget(target);

        const xBits = parsedTarget[0].toBits(4);
        const yBits = parsedTarget[1].toBits(4);
        const serializedTarget = Field.fromBits([...xBits, ...yBits]);

        return serializedTarget;
    }

    /**
     * Deserialize a serialized target.
     * @param {Field} serializedTarget - The serialized target as a Field elements.
     * @returns {Field[]} The deserialized x/y coordinate pair.
     */
    static deserializeTarget(serializedTarget: Field) { 
        const bits = serializedTarget.toBits(8);
        const targetX = Field.fromBits(bits.slice(0, 4));
        const targetY = Field.fromBits(bits.slice(4, 8));

        return [targetX, targetY];
    }

    /**
     * Validate a serialized target to ensure it falls within the game map range after deserialization.
     * Throws an error if the target is out of bounds.
     * @param {Field} serializedTarget - The serialized target as a Field object.
     */
    static validateTarget(serializedTarget: Field) { 
        const target = AttackUtils.deserializeTarget(serializedTarget);
        target[0].assertLessThan(10, 'Target x coordinate is out of bound!');
        target[1].assertLessThan(10, 'Target y coordinate is out of bound!');
    }

    /**
     * Serialize hit count history into a single Field object.
     * @param {Field[]} hitHistory - An array containing hit count history for both players.
     * @returns {Field} The serialized hit count history as a Field object.
     */
    static serializeHitCountHistory(hitHistory: Field[]) {
        // Extract hit counts for player 1 and player 2
        const [player1HitCount, player2HitCount] = hitHistory;
        
        // Convert hit counts to bit representations
        const player1HitCountBits = player1HitCount.toBits(5);
        const player2HitCountBits = player2HitCount.toBits(5);

        // Concatenate bit representations and create a single Field object
        const serializedHitCountHistory = Field.fromBits([...player1HitCountBits, ...player2HitCountBits]);
        
        return serializedHitCountHistory;
    }

    /**
     * Serialize hit target history for both players into a single Field object.
     * 
     * @note hit target refers to a player's target that resulted in a successful hit
     * 
     * @param {Field[][]} hitTargetHistory - An array containing hit target(encoded) history for both players.
     * @returns {Field} The serialized hit target history as a Field object.
     */
    static serializeHitTargetHistory(hitTargetHistory: Field[][]) {
        // Extract hit target history for player 1 and player 2
        const [player1HitTargets, player2HitTargets] = hitTargetHistory;
        
        // Convert hit target history to bit representations and flatten the arrays
        const player1HitTargetBits = player1HitTargets.map(f => f.toBits(7)).flat();
        const player2HitTargetBits = player2HitTargets.map(f => f.toBits(7)).flat();

        // Concatenate bit representations and create a single Field object
        const serializedHitTargetHistory = Field.fromBits([...player1HitTargetBits, ...player2HitTargetBits]);
        
        return serializedHitTargetHistory;
    }

    /**
     * Deserialize serialized hit target history into an array containing hit target(encoded) history for both players.
     * 
     * @note hit target refers to a player's target that resulted in a successful hit
     * 
     * @param {Field} hitTargetHistory - The serialized hit target history as a Field object.
     * @returns {Field[][]} An array containing deserialized hit target history for both players.
     */
    static deserializeHitTargetHistory(hitTargetHistory: Field) {
        // Convert serialized hit target history to bit representation
        const hitTargetHistoryBits = hitTargetHistory.toBits(119);
        let hitTargetsBits: Bool[][] = [];

        // Slice the bit representation into smaller arrays of length 7 and convert to Field objects
        for (let i = 0; i < hitTargetHistoryBits.length; i += 7) {
            const parsedArray = hitTargetHistoryBits.slice(i, i + 7);
            hitTargetsBits.push(parsedArray);
        }

        return hitTargetsBits.map(f => Field.fromBits(f));
    }

    /**
     * Update the hit target history for a player based on the outcome of a target.
     * @param {Field[]} target - The adversary target coordinates.
     * @param {Bool} isHit - A boolean indicating whether the target resulted in a hit.
     * @param {Field[]} playerHitTargets - The current hit target history for the player.
     * @param {Field} index - The index at which to update the hit target history.
     * @returns {Field[]} The updated hit target history for the player.
     * @note Ensure that the target is validated before calling this function to maintain data integrity.
     */
    static updateHitTargetHistory(target: Field[], isHit: Bool, playerHitTargets: Field[], index: Field) {
        // Encode the target coordinates for storage in the hit target history.
        const encodedTarget = AttackUtils.encodeHitTarget(target);
        
        // Use the encoded target as the updated value if the target resulted in a hit,
        // otherwise use 0 as the initial value to indicate a miss.
        let encodedHitTarget = Provable.if(
            isHit,
            encodedTarget,
            Field(0),
        );
        
        // Create a copy of the hit target history to prevent tampering with the original array.
        // This ensures the integrity of the input data and maintains the provability of the attack method.
        const updatedPlayerHitTargets = Provable.witness(Provable.Array(Field, 17), () => {
            const hitTargetIndex = Number(index.toBigInt());
            
            // Make a copy of the original hit target history array.
            let updated = [...playerHitTargets];
            
            // Update the hit target history at the specified index with the encoded hit target.
            updated[hitTargetIndex] = encodedHitTarget;
            
            return updated;
        });

        return updatedPlayerHitTargets;
    }
    
    /**
     * Serialize hit count and hit target history into a single data structure for storage.
     * @param {Field} serializedHitCountHistory - The serialized hit count history for both players.
     * @param {Field} serializeHitTargetHistory - The serialized hit target history for both players.
     * @returns {Field} The serialized hit history wrapping both hit count & hit target history.
     */
    static serializeHitHistory(serializedHitCountHistory: Field, serializeHitTargetHistory: Field) { 
        // Extract the bits representing hit count history and hit target history.
        const hitCountHistoryBits = serializedHitCountHistory.toBits(10);
        const hitTargetHistoryBits = serializeHitTargetHistory.toBits(238);

        // Combine the bits to create the serialized hit history data structure.
        const serializedHitHistory = Field.fromBits([...hitCountHistoryBits, ...hitTargetHistoryBits]);
        
        return serializedHitHistory;
    }

    /**
     * Deserialize hit history from the serialized wrapper into separate hit count and hit target histories.
     * @param {Field} serializedHitHistory - The serialized hit history field element.
     * @returns {[Field[], Field[][]]} An array containing hit count and hit target histories for both players.
     */
    static deserializeHitHistory(serializedHitHistory: Field): [Field[], Field[][]] { 
        // Extract the bits from the serialized hit history data structure.
        const bits = serializedHitHistory.toBits(248);

        // Extract hit count history for both players.
        const player1HitCount = Field.fromBits(bits.slice(0, 5));
        const player2HitCount = Field.fromBits(bits.slice(5, 10));

        // Extract serialized hit target history for both players.
        const serializedPlayer1HitTargetHistory = Field.fromBits(bits.slice(10, 129));
        const serializedPlayer2HitTargetHistory = Field.fromBits(bits.slice(129, 248));

        // Deserialize hit target history for both players.
        const player1HitTargets = AttackUtils.deserializeHitTargetHistory(serializedPlayer1HitTargetHistory);
        const player2HitTargets = AttackUtils.deserializeHitTargetHistory(serializedPlayer2HitTargetHistory);

        return [
            [player1HitCount, player2HitCount], 
            [player1HitTargets, player2HitTargets],
        ];
    }

    /**
     * Encode hit target coordinates into a single field element for storage efficiency.
     * 
     * We encode data differently than `serializeTarget` to showcase an alternative approach to conserve on-chain storage space.
     * When bitifying two numbers from 0 to 9 together, it typically requires 8 bits in total. However, by employing a technique
     * like bitifying an encode variable such as 9 + 9*10 + 1, we reduce the storage requirement to 7 bits. This results in a total saving of 34 bits
     * because we store a maximum of 34 targets that land a successful hit.
     * 
     * Serializing an encoded target saved 34 bits of storage otherwise we would have exceed the field element size.
     * 
     * Encoding is achieved by mapping a target [x, y] to a single field element: x + 10 * y + 1.
     * To distinguish encoded hit targets from initial values, we add one to the result. For example, if [0, 0] represents 
     * a target that successfully hits the adversary, serializing it would result in 0, which is indistinguishable from 
     * the initial value(0) and prone to errors. Therefore, we add one to the encoded value to avoid confusion and ensure 
     * proper differentiation.
     * 
     * @param {Field[]} hitTarget - The coordinates of the hit target [x, y].
     * @returns {Field} The encoded hit target.
     * @note hit target refers to a player's target that resulted in a successful hit
     */
    static encodeHitTarget(hitTarget: Field[]) { 
        const encodeHitTarget = hitTarget[0].add(hitTarget[1].mul(10)).add(1);
        return encodeHitTarget;
    }

    /**
     * Ensure that a hit target is not nullified for a given player.
     * 
     * This function prevents a player from selecting a target that has already been hit in a previous turn,
     * thereby ensuring fair gameplay. Allowing such action would unfairly score points multiple times
     * with the same target, compromising game fairness. 
     * 
     * Missed targets are not stored as they do not affect the game state, making it illogical to select them.
     * 
     * @param {Field[]} target - The coordinates of the hit target [x, y].
     * @param {Field[]} hitTargetHistory - The hit target history of the player.
     * @returns {Bool} A boolean indicating whether the target has already been hit.
     */
    static validateHitTargetUniqueness(target: Field[], hitTargetHistory: Field[]) {
        // We opt not to deserialize the hitTargetHistory to save computational resources.
        // Instead, we serialize the target and then directly scan occurrences through an array of serialized targets. 
        // This approach conserves computational resources and enhances efficiency.
        let serializedTarget = AttackUtils.encodeHitTarget(target);

        let isNullified = Provable.witness(Bool, () => {
            let isStoredBefore = hitTargetHistory.some(item => item.equals(serializedTarget).toBoolean());
            return Bool(isStoredBefore)
        });

        return isNullified
    }
}

class AttackCircuit {
    /**
     * Determine whether or not a given ship is hit by a given adversary target.
     * @param {Field[]} target - The x/y coordinate pair representing the adversary target.
     * @param {Field[]} ship - The ship coordinates.
     * @param {number} shipLength - The length of the ship.
     * @returns {Bool} True if the ship is hit, false otherwise.
     */
    static scanShip(target: Field[], ship: Field[], shipLength: number) { 
        // Return hit result for a horizontal ship
        const hitHorizontalShip = () => {
            let xHit = Bool(false);
            let yHit = Bool(false);
            for (let i = 0; i < shipLength; i++) {
                xHit = xHit.or(ship[0].add(i).equals(target[0]));
                yHit = yHit.or(ship[1].equals(target[1]));
            }
            return xHit.and(yHit);
        }
        
        // Return hit result for a vertical ship
        const hitVerticalShip = () => {
            let xHit = Bool(false);
            let yHit = Bool(false);
            for (let i = 0; i < shipLength; i++) {
                xHit = xHit.or(ship[0].equals(target[0]));
                yHit = yHit.or(ship[1].add(i).equals(target[1]));
            }
            return xHit.and(yHit);
        }

        // True if hit, false if missed
        const hitResult = Provable.if(ship[2].equals(1), hitVerticalShip(), hitHorizontalShip());
        return hitResult;
    }

    /**
     * Determine whether or not a target hits a given board arrangement.
     * @param {Field[][]} ships - The coordinates of all ships on the board.
     * @param {Field[]} target - The x/y coordinate pair representing the adversary target.
     * @returns {Bool} True if the target hits a ship, false otherwise.
     */
    static attack(ships: Field[][], shot: Field[]) { 
        // Assert that the shot is within board range
        shot[0].assertLessThan(10, 'Target x coordinate is out of bound!');
        shot[1].assertLessThan(10, 'Target y coordinate is out of bound!');

        // Scan for hit on all ships
        const shipLengths = [5, 4, 3, 3, 2];

        let hit = Bool(false);
        for (let i=0; i<5; i++) {
            hit = hit.or(AttackCircuit.scanShip(shot, ships[i], shipLengths[i]));
        }

        return hit;
    }
}
