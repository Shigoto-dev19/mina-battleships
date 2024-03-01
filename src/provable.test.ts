import { BoardCircuit, BoardUtils, AttackCircuit, AttackUtils } from './provableUtils';

describe('Board Circuit Tests', () => {
    describe('Valid Board Checks', () => {
        /**
         * Tests the validity of a given board configuration.
         * 
         * This function takes an array representing the ship configurations on a Battleships grid.
         * It parses the input ships, computes their hash, and serializes the board.
         * Then, it validates the serialized board using the BoardCircuit.
         * Finally, it compares the validation hash with the computed hash to ensure validity.
         * 
         * @param {number[][]} ships - An array representing the ship configurations on the board.
         * @returns {void} - This function does not return anything but throws an error if validation fails.
         */
        function testValidBoard(ships: number[][]) { 
            const parsedShips = BoardUtils.parse(ships);
            const hash = BoardUtils.hash(parsedShips);
            
            const serializedBoard = BoardUtils.serialize(ships); 
            const validationHash = BoardCircuit.validateBoard(serializedBoard);

            expect(validationHash).toEqual(hash);
        }

        it("Prove valid board 1", () => {
            const ships1 = [
                [0, 0, 0],
                [0, 1, 0],
                [0, 2, 0],
                [0, 3, 0],
                [0, 4, 0],
            ];
            testValidBoard(ships1);
        });

        it("Prove valid board 2", () => {
            const ships2 = [
                [9, 0, 1],
                [9, 5, 1],
                [6, 9, 0],
                [6, 8, 0],
                [7, 7, 0],
            ];
            testValidBoard(ships2);
        });

        it("Prove valid board 3", () => {
            const ships3 = [
                [0, 1, 1],
                [4, 3, 0],
                [3, 3, 1],
                [5, 9, 0],
                [1, 7, 1],
            ];
            testValidBoard(ships3);
        });
    });

    describe('Out of Bound Checks', () => {
        /**
         * Tests if a given board configuration exceeds the ragne of the game grid.
         * 
         * This function takes an array representing the ship configurations on a Battleships board.
         * It attempts to serialize the board and validate it using the BoardCircuit.
         * If the validation throws an error, it verifies that the error message matches the expected errorMessage.
         * 
         * @param {number[][]} ships - An array representing the ship configurations on the board.
         * @param {string} [errorMessage] - Optional. The expected error message if the board configuration is invalid.
         * @returns {void} - This function does not return anything but throws an error if the validation fails or if the error message mismatches.
         */
        function testInvalidRange(ships: number[][], errorMessage?: string) {      
            const validationRangeError = () => {
                const serializedBoard = BoardUtils.serialize(ships); 
                BoardCircuit.validateBoard(serializedBoard);
            }
            
            expect(validationRangeError).toThrowError(errorMessage);
        }

        it("Range violation: board 1: negative", () => {
            const ships = [
                [-1, 0, 0],
                [0, 1, 0],
                [0, 2, 0],
                [0, 3, 0],
                [0, 4, 0],
            ];
            testInvalidRange(ships);   
        });

        it("Range violation: board 2: out of bounds x/ y", () => {
            const ships = [
                [0, 0, 0],
                [0, 10, 0],
                [0, 2, 0],
                [0, 3, 0],
                [0, 4, 0],
            ];
            testInvalidRange(ships, 'Ship2 is out of board range!');
        });

        it("Range violation: board 3: out of bounds z", () => {
            const ships = [
                [0, 0, 0],
                [0, 1, 0],
                [0, 2, 0],
                [0, 3, 0],
                [0, 4, 2],
            ];
            testInvalidRange(ships, 'Coordinate z should be 1 or 0!');
        });
    });

    describe("Collision Checks", () => {
        /**
         * Tests if there are collisions in the ship placements on the board.
         * 
         * This function takes an array representing the ship configurations on a Battleships board
         * and attempts to serialize the board. It then validates the board using the BoardCircuit.
         * If the validation throws an error, it verifies that the error message matches the expected errorMessage.
         * 
         * @param {number[][]} ships - An array representing the ship configurations on the board.
         * @param {string} errorMessage - The expected error message if there are collisions in the ship placements.
         * @returns {void} - This function does not return anything but throws an error if the validation fails or if the error message mismatches.
         */
        function testCollision(ships: number[][], errorMessage: string) { 
            const serializedBoard = BoardUtils.serialize(ships); 
            const mockCollisionError = () => {
                BoardCircuit.validateBoard(serializedBoard);
            }
            
            expect(mockCollisionError).toThrowError(errorMessage);
        }

        it("Placement violation: board 1", () => {
            const ships1 = [
                [0, 0, 0],
                [0, 0, 0],
                [0, 2, 0],
                [0, 3, 0],
                [0, 4, 0],
            ];
            testCollision(ships1, 'Invalid Board! Collision occurred when placing Ship2!');
        });

        it("Placement violation: board 2", () => {
            const ships2 = [
                [0, 1, 1],
                [4, 3, 0],
                [3, 3, 0],
                [5, 9, 0],
                [1, 8, 1],
            ];
            testCollision(ships2, 'Invalid Board! Collision occurred when placing Ship3!');
        });

        it("Placement violation: board 3", () => {
            const ships3 = [
                [0, 1, 1],
                [4, 3, 0],
                [5, 5, 0],
                [6, 5, 1],
                [1, 7, 1],
            ];
            testCollision(ships3, 'Invalid Board! Collision occurred when placing Ship4!');
        });

        it("Placement violation: board 4", () => {
            const ships4 = [
                [9, 0, 1],
                [9, 5, 1],
                [6, 9, 0],
                [6, 8, 0],
                [7, 7, 1],
            ];
            testCollision(ships4, 'Invalid Board! Collision occurred when placing Ship5!');
        });
    });
});

describe('Attack Circuit Tests', () => {
    describe('Correct hit report assertion', () => {
        /**
         * Tests if a given attack on a Battleships board is valid.
         * 
         * This function takes an array representing the ship configurations on a Battleships board,
         * and a target array representing the coordinates of the attack. It then parses the ships,
         * performs the attack using the AttackCircuit, and checks if the result matches the expected hit outcome.
         * 
         * @param {number[][]} ships - An array representing the ship configurations on the board.
         * @param {number[]} target - An array representing the coordinates of the attack.
         * @param {boolean} [hit=true] - The expected outcome of the attack, true if it's a hit, false if it's a miss.
         * @returns {void} - This function does not return anything but throws an error if the attack result mismatches the expected hit outcome.
         */
        function testValidAttack(ships: number[][], target: number[], hit=true) { 
            const parsedShips = BoardUtils.parse(ships);
            const parsedTarget = AttackUtils.parseTarget(target);
            const attackResult = AttackCircuit.attack(parsedShips, parsedTarget);
            
            expect(attackResult.toBoolean()).toEqual(hit);
        }

        it("Prove hitting attack 1: hit on head", () => {
            const ships1 = [
                [0, 0, 0],
                [0, 1, 0],
                [0, 2, 0],
                [0, 3, 0],
                [0, 4, 0],
            ];
            const target1 = [0, 0];
            testValidAttack(ships1, target1);
        });

        it("Prove missing attack 2: miss with no collision", async () => {
            const ships1 = [
                [0, 0, 0],
                [0, 1, 0],
                [0, 2, 0],
                [0, 3, 0],
                [0, 4, 0],
            ];
            const target2 = [9, 5];
            testValidAttack(ships1, target2, false);
        });

        it("Prove hitting attack 3: hit off head on z = 0", async () => {
            const ships2 = [
                [1, 2, 0],
                [2, 8, 0],
                [5, 4, 0],
                [5, 6, 0],
                [8, 0, 0]
            ];
            const target1 = [4, 2];
            testValidAttack(ships2, target1);
        });

        it("Prove missing attack 4: vertical miss with horizontal hit", async () => {
            // demonstrate miss computation even if z=0 collision when z = 1
            const ships2 = [
                [1, 2, 0],
                [2, 8, 0],
                [5, 4, 0],
                [5, 6, 0],
                [8, 0, 0],
            ];
            const target2 = [1, 3];
            testValidAttack(ships2, target2, false);
        });

        it("Prove hitting attack 5: hit off head on z = 1", async () => {
            const ships3 = [
                [1, 1, 1],
                [5, 1, 1],
                [4, 4, 1],
                [1, 7, 1],
                [3, 8, 0],
            ];
            const target1 = [4, 5];
            testValidAttack(ships3, target1);
        });

        it("Prove missing attack 6: horizontal miss with vertical hit", async () => {
            // demonstrate miss computation even if z=1 collision when z = 0
            const ships3 = [
                [1, 1, 1],
                [5, 1, 1],
                [4, 4, 1],
                [1, 7, 1],
                [3, 8, 0],
            ];
            const target2 = [2, 1];
            testValidAttack(ships3, target2, false);
        });
    });

    describe("False hit report assertion", () => {
        // The opposite of "testValidAttack" function in line 197.
        function testInvalidAttack(ships: number[][], target: number[], expectedAttackResult: boolean) { 
            const parsedShips = BoardUtils.parse(ships);
            const parsedTarget = AttackUtils.parseTarget(target);
            const attackResult = AttackCircuit.attack(parsedShips, parsedTarget);
            
            expect(attackResult.toBoolean()).not.toEqual(expectedAttackResult);
        }

        it("Hit assertion violation turn 1: head hit but report miss", async () => {
            const ships1 = [
                [0, 0, 0],
                [0, 1, 0],
                [0, 2, 0],
                [0, 3, 0],
                [0, 4, 0],
            ];
            const target1 = [0, 0];
            testInvalidAttack(ships1, target1, false);
        });

        it("Hit assertion violation turn 2: head miss but report hit", async () => {
            const ships1 = [
                [0, 0, 0],
                [0, 1, 0],
                [0, 2, 0],
                [0, 3, 0],
                [0, 4, 0],
            ];
            const target2 = [6, 6];
            testInvalidAttack(ships1, target2, true);
        });

        it("Hit assertion violation turn 3: z=0 hit but report miss", async () => {
            const ships2 = [
                [1, 2, 0],
                [2, 8, 0],
                [5, 4, 0],
                [5, 6, 0],
                [8, 0, 0],
            ];
            const target1 = [3, 2];
            testInvalidAttack(ships2, target1, false);
        });

        it("Hit assertion violation turn 4: z=1 miss but report hit", async () => {
            const ships2 = [
                [1, 2, 0],
                [2, 8, 0],
                [5, 4, 0],
                [5, 6, 0],
                [8, 0, 0],
            ];
            const target2 = [1, 3];
            testInvalidAttack(ships2, target2, true);
        });

        it("Hit assertion violation turn 5: z=0 miss but report hit", async () => {
            const ships3 = [
                [1, 1, 1],
                [5, 1, 1],
                [4, 4, 1],
                [1, 7, 1],
                [3, 8, 0],
            ];
            const target1 = [2, 1];
            testInvalidAttack(ships3, target1, true);
        });

        it("Hit assertion violation turn 6: z=1 hit but report miss", async () => {
            const ships3 = [
                [1, 1, 1],
                [5, 1, 1],
                [4, 4, 1],
                [1, 7, 1],
                [3, 8, 0],
            ];
            const target2 = [1, 3];
            testInvalidAttack(ships3, target2, false);
        });
    });

    describe('Out of bound tests', () => {
        /**
         * Tests if an attack is out of bounds on the board.
         * 
         * This function takes an array representing the ship configurations on a Battleships board,
         * a target array representing the coordinates of the attack, and an error message to expect.
         * It then parses the ships and attempts to perform the attack using the AttackCircuit.
         * If the attack is out of bounds, it should throw an error with the specified error message.
         * 
         * @param {number[][]} ships - An array representing the ship configurations on the board.
         * @param {number[]} target - An array representing the coordinates of the attack.
         * @param {string} errorMessage - The error message expected to be thrown if the attack is out of bounds.
         * @returns {void} - This function does not return anything but throws an error if the attack error message mismatches.
         */
        function testOutOfBoundAttack(ships: number[][], target: number[], errorMessage: string) { 
            const parsedShips = BoardUtils.parse(ships);
            const parsedTarget = AttackUtils.parseTarget(target);
            const attackError = () => {
                AttackCircuit.attack(parsedShips, parsedTarget);
            }
            
            expect(attackError).toThrowError(errorMessage);
        }

        it("Shot range violation turn 1: negative", () => {
            const ships = [
                [0, 0, 0],
                [0, 1, 0],
                [0, 2, 0],
                [0, 3, 0],
                [0, 4, 0],
            ];
            const target1 = [-1, 3];
            testOutOfBoundAttack(ships, target1, 'Target x coordinate is out of bound!');
        });

        it("Shot range violation turn 2: x out of bounds", () => {
            const ships = [
                [0, 0, 0],
                [0, 1, 0],
                [0, 2, 0],
                [0, 3, 0],
                [0, 4, 0],
            ];
            const target2 = [10, 3];
            testOutOfBoundAttack(ships, target2, 'Target x coordinate is out of bound!');
        });

        it("Shot range violation turn 3: y out of bounds", () => {
            const ships = [
                [0, 0, 0],
                [0, 1, 0],
                [0, 2, 0],
                [0, 3, 0],
                [0, 4, 0],
            ];
            const target3 = [0, 13];
            testOutOfBoundAttack(ships, target3, 'Target y coordinate is out of bound!');
        });
    });
});
