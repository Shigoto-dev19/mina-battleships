import { Field } from 'o1js';
import { BoardCircuit, BoardUtils, AttackCircuit } from './client';

/*
Each ship is an array [x, y, z] where 
x = x coordinate on the board
y = y coordinate on the board 
z = is a binary where 0=horizontal & 1=verical orientation ship placements
*/ 

describe('Board Tests', () => {
    describe('Valid Board Checks', () => {
        function testValidBoard(ships: number[][]) { 
            const parsedShips = BoardUtils.parse(ships);
            const hash = BoardUtils.hash(parsedShips);
            
            const serializedBoard = BoardUtils.serializeBoard(ships); 
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
        function testInvalidRange(ships: number[][], errorMessage?: string) {      
            const validationRangeError = () => {
                const serializedBoard = BoardUtils.serializeBoard(ships); 
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
        function testCollision(ships: number[][], errorMessage: string) { 
            const serializedBoard = BoardUtils.serializeBoard(ships); 
            const validationCollisionrror = () => {
                BoardCircuit.validateBoard(serializedBoard);
            }
            expect(validationCollisionrror).toThrowError(errorMessage);
        }

        it("Placement violation: board 1", () => {
            const ships1 = [
                [0, 0, 0],
                [0, 0, 0],
                [0, 2, 0],
                [0, 3, 0],
                [0, 4, 0],
            ];
            testCollision(ships1, 'Collision occured when placing Ship2!');
        });

        it("Placement violation: board 2", () => {
            const ships2 = [
                [0, 1, 1],
                [4, 3, 0],
                [3, 3, 0],
                [5, 9, 0],
                [1, 8, 1],
            ];
            testCollision(ships2, 'Collision occured when placing Ship3!');
        });

        it("Placement violation: board 3", () => {
            const ships3 = [
                [0, 1, 1],
                [4, 3, 0],
                [5, 5, 0],
                [3, 5, 0],
                [1, 7, 1],
            ];
            testCollision(ships3, 'Collision occured when placing Ship4!');
        });

        it("Placement violation: board 4", () => {
            const ships4 = [
                [9, 0, 1],
                [9, 5, 1],
                [6, 9, 0],
                [6, 8, 0],
                [7, 7, 1],
            ];
            testCollision(ships4, 'Collision occured when placing Ship5!');
        });
    });
});

describe('Attack Tests', () => {
    describe('Correct hit assertion', () => {
        function testValidAttack(ships: number[][], shot: number[], hit=true) { 
            const parsedShips = BoardUtils.parse(ships);
            const attackResult = AttackCircuit.attack(parsedShips, shot.map(Field));
            
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

    describe("False hit assertion", () => {
        function testInvalidAttack(ships: number[][], shot: number[], expectedAttackResult: boolean) { 
            const parsedShips = BoardUtils.parse(ships);
            const attackResult = AttackCircuit.attack(parsedShips, shot.map(Field));
            
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
        function testOutOfBoundAttack(ships: number[][], shot: number[], errorMessage: string) { 
            const parsedShips = BoardUtils.parse(ships);
            const attackError = () => {
                AttackCircuit.attack(parsedShips, shot.map(Field));
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
            testOutOfBoundAttack(ships, target1, 'target x coordinate is out of bound!');
           
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
            testOutOfBoundAttack(ships, target2, 'target x coordinate is out of bound!');
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
            testOutOfBoundAttack(ships, target3, 'target y coordinate is out of bound!');
        });
    });
});
