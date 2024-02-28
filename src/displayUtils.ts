export {
  PENDING_BLUE_SYMBOL,
  HIT_GREEN_SYMBOL,
  MISS_RED_SYMBOL,
  generateEmptyGameGrid,
  positionShipsOnGrid,
  stringifyGameGrid,
  printPlayerAndAdversaryBoards, 
  printHitResult,
  parseCoordinates,
}

const PENDING_BLUE_SYMBOL = '\x1b[34mP\x1b[0m\x1b[0m';
const HIT_GREEN_SYMBOL = '\x1b[32mH\x1b[0m';
const MISS_RED_SYMBOL = '\x1b[31mM\x1b[0m';

/**
 * Converts a flat array into a nested array with subarrays of length=10.
 * This function is a helper to set up a 10X10 Battleships Grid.
 * 
 * @param flatArray The flat array to be converted into a nested array.
 * @returns The nested array with subarrays containing elements from the flat array.
 */
function nestifyArray(flatArray: string[]) {
  const subarrayLength = 10;
  const nestedArray = Array.from({ length: subarrayLength }, (_, i) => flatArray.slice(i * 10, (i + 1) * 10));
  
  return nestedArray
}

/**
 * Generates an empty game grid for Battleships, represented as a 10x10 nested array.
 * Each cell in the grid is initially empty (' ').
 * 
 * @returns The empty game grid represented as a nested array.
 */
function generateEmptyGameGrid(): string[][] {
  // Create a flat array filled with empty cells (' ') representing the game grid
  const flatEmptyGrid = new Array(100).fill(' ');

  // Convert the flat array into a nested array representing a 10x10 grid
  const emptyGameGrid = nestifyArray(flatEmptyGrid);

  // Return the empty game grid
  return emptyGameGrid;
}

/**
 * Positions ships on a 10x10 grid representing a Battleships board.
 * 
 * @param ships An array of ship configurations, where each ship is represented as [x, y, z] coordinates:
 *              x = x coordinate on the board
 *              y = y coordinate on the board 
 *              z = orientation (0=horizontal, 1=vertical)
 * 
 * @returns The game grid with ships positioned according to the provided configuration.
 */
function positionShipsOnGrid(board: number[][]): string[][] {
  // Symbol representing a ship
  const SHIP_SYMBOL = '\u{1F6E5}';
  
  // Create an empty Battleships game frid
  let battleshipsGrid = generateEmptyGameGrid();
  
  // Lengths of the ships to be placed
  const lengths = [5, 4, 3, 3, 2];
  
  // Iterate over the ships to position them on the grid
  for (let index = 0; index < lengths.length; index++) {
    let length = lengths[index];
    
    // Position each ship on the grid
    for (let i = 0; i < length; i++) {
      // Place vertical ships
      if (board[index][2] === 1) { 
        let x = board[index][1] + i;
        let y = board[index][0]; 
        battleshipsGrid[x][y] = SHIP_SYMBOL;
      }
      // Place horizontal ships
      else {
        let x = board[index][1];
        let y = board[index][0] + i;
        battleshipsGrid[x][y] = SHIP_SYMBOL;
      }
    }
  }
  
  // Return the game grid with ships positioned
  return battleshipsGrid;
}

/**
 * Convert a game grid with placed ships into a string representation.
 * 
 * @param gameGrid The game grid with ships positioned as a 2D array of strings.
 * @returns A string representation of a notated game grid with ship positions.
 */
function stringifyGameGrid(gameGrid: string[][]): string {
  // Row and column labels
  let rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  let columns = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  let space = '   ';
  
  // Build the column labels
  let col = '\n ';
  for (let i = 0; i < 10; i++) {
    col += space + columns[i];
  }
  
  // Construct the string representation of the game grid
  let nestedGameGrid = '\n  -----------------------------------------\n';
  for (let i = 0; i < 10; i++) {
    nestedGameGrid +=
      `${rows[i]} | ${gameGrid[i][0]} | ${gameGrid[i][1]} | ${gameGrid[i][2]} | ${gameGrid[i][3]} | ${gameGrid[i][4]} | ` +
      `${gameGrid[i][5]} | ${gameGrid[i][6]} | ${gameGrid[i][7]} | ${gameGrid[i][8]} | ${gameGrid[i][9]} |\n` +
      '  -----------------------------------------\n';
  }
  
  // Return the string representation of the game grid
  return col + nestedGameGrid;
}

/**
 * Prints the player's game board and the adversary's game board side by side for UI simulation.
 * 
 * @param stringifedPlayerGameGrid The string representation of the player's game grid.
 * @param stringifiedAdversaryGameGrid The string representation of the adversary's game grid.
 */
function printPlayerAndAdversaryBoards(stringifedPlayerGameGrid: string, stringifiedAdversaryGameGrid: string) {
  // Split the string representations of the boards into rows
  const rows1 = stringifedPlayerGameGrid.split('\n');
  const rows2 = stringifiedAdversaryGameGrid.split('\n');

  // Define spacing and headers for the boards
  let space1 = '         ';
  let space2 = '            ';
  let boardHeader1 = '                 Your Board                ';
  let boardHeader2 = "            Your Adversary's Board           ";

  // Print headers for both boards
  console.log('\n' + space1 + boardHeader1 + space2 + boardHeader2);
  
  // Print the first row of each board side by side
  console.log('\n' + space1 + rows1[1] + space2 + '  '+ rows2[1]);

  // Print the remaining rows of each board side by side
  for (let i = 2; i < rows1.length; i++)
    console.log(space1 + rows1[i] + space2 + rows2[i]);
}

/**
 * Determines the hit result based on the hit value.
 * 
 * @param {number} hit The hit value indicating the outcome of the hit (1 for hit, 0 for miss).
 * @returns {string} The hit result (either "Hit", "Miss", or "Pending").
 */
function printHitResult(hit: number): string {
  let hitResult;
  if (hit == 1) hitResult = "Hit"; 
  else if (hit == 0) hitResult = "Miss";
  else hitResult = "Pending";

  return hitResult ;       
}

/**
 * Parses numeric coordinates into a string representation.
 * 
 * @param {number[]} target The numeric coordinates to parse, where target[0] represents the column index and target[1] represents the row index.
 * @returns {string} The string representation of the coordinates (e.g., "A1").
 */
function parseCoordinates(target: number[]) {
  const alphabet = 'ABCDEFGHIJ';
  const row = alphabet[target[1]];
  const column = target[0];

  return `${row}${column}`;
}