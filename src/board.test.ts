import { BoardCircuit, BoardUtils } from './client';

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
  