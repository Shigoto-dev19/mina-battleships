/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { 
    Field, 
    Bool,
    Poseidon,
    Provable,
    PublicKey,
    PrivateKey,
    MerkleTree,
    Mina,
} from 'o1js';
import {
    parseGameBoard,
    generateEmptyGameGrid,
    stringifyBoard,
    printBoard,
} from './game.js'
import { 
    Battleships,
     HitMerkleWitness, 
     TargetMerkleWitness 
} from './Battleships.js';

export { 
    BoardUtils, 
    BoardCircuit,
    AttackUtils,
    AttackCircuit,
    BattleShipsClient,
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
        return  Poseidon.hash(board.flat());
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

//TODO: Add "invalid board" message inside assertion logs
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
            BoardCircuit.validateShipInRange(ships[i], shipLengths[i], `Ship${i+1} is out of board range!`);
            // collision check
            boardMap = BoardCircuit.placeShip(ships[i], shipLengths[i], boardMap,`Collision occured when placing Ship${i+1}!`);
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
        shot[0].assertLessThan(10, 'target x coordinate is out of bound!');
        shot[1].assertLessThan(10, 'target y coordinate is out of bound!');

        // scan hit for all ships
        const shipLengths = [5, 4, 3, 3, 2];
        let hit = Bool(false);
        for (let i=0; i<5; i++) {
            hit = hit.or(AttackCircuit.scanShip(shot, ships[i], shipLengths[i]));
        }

        return hit;
    }
}

//TODO Commit print board/grid code
//TODO Point to redundancy of game data storage and that the merkle tree are sustainble in case of error
class BattleShipsClient {
    public zkapp: Battleships;

    private playerKey: PrivateKey;
    public playerAddress: PublicKey;
    public playerId: Field;

    private board: number[][];
    private serializedBoard: Field;

    public playerTargets: number[][];
    public adversaryTargets: number[][];

    public playerHitCount: number;
    public adversaryHitCount: number;

    public targetTree: MerkleTree;
    public hitTree: MerkleTree;

    public playerGridDisplay: string[][];
    public adversaryGridDisplay: string[][];

    public playerHits: number[];

    public winner: boolean;
    
    constructor(
        zkapp: Battleships,
        playerKey: PrivateKey,
        board: number[][],
    ) {
        this.zkapp = zkapp;

        this.board = board;
        this.serializedBoard = BoardUtils.serialize(board);

        this.playerKey = playerKey;
        this.playerAddress = playerKey.toPublicKey();
        this.playerId = BoardUtils.generatePlayerId(this.serializedBoard, this.playerAddress);

        this.playerTargets = [];
        this.adversaryTargets = [];
        
        this.playerHitCount = 0;
        this.adversaryHitCount = 0;

        this.targetTree = new MerkleTree(8);
        this.hitTree = new MerkleTree(8);

        this.playerGridDisplay = parseGameBoard(this.board);
        this.adversaryGridDisplay = generateEmptyGameGrid();

        this.playerHits = [];

        this.winner = false;
    }

    static initialize(zkapp: Battleships, playerKey: PrivateKey, board: number[][]) {
        return new BattleShipsClient(
            zkapp,
            playerKey,
            board,
        );
    }
    
    async hostGame() {
        const hostGameTx = await Mina.transaction(this.playerAddress, () => {
          this.zkapp.hostGame(this.serializedBoard);
        });
        
        await hostGameTx.prove();
        await hostGameTx.sign([this.playerKey]).send();
    }

    async joinGame() {
        const joinGameTx = await Mina.transaction(this.playerAddress, () => {
          this.zkapp.joinGame(this.serializedBoard);
        });
        
        await joinGameTx.prove();
        await joinGameTx.sign([this.playerKey]).send();
    }

    async playFirstTurn(firstTarget: number[]) {
        let index = this.zkapp.turns.get();
        let w = this.targetTree.getWitness(index.toBigInt());
        let targetWitness = new TargetMerkleWitness(w);

        const serializedTarget = AttackUtils.serializeTarget(firstTarget);

        const firstTurnTx = await Mina.transaction(this.playerAddress, () => {
          this.zkapp.firstTurn(serializedTarget, this.serializedBoard, targetWitness);
        });

        await firstTurnTx.prove();
        await firstTurnTx.sign([this.playerKey]).send();

        // fetch the updated target on-chain
        const storedTarget = this.zkapp.target.get();

        // update the local off-chain target tree
        this.targetTree.setLeaf(index.toBigInt(), storedTarget); 

        // update local storage and point target to the adversary's grid display
        this.playerTargets.push(firstTarget);
        this.adversaryGridDisplay[firstTarget[1]][firstTarget[0]] = '\x1b[34mT\x1b[0m\x1b[0m';
    }

    async playTurn(target: number[]) {
        // fetch the target from the previous turn 
        const adversarySerializedTarget = this.zkapp.target.get();
        
        // deserialize & update the local enemy target storage
        const adversaryTarget = AttackUtils.deserializeTarget(adversarySerializedTarget).map(f => Number(f.toBigInt()));
        this.adversaryTargets.push(adversaryTarget);
        
        // fetch the last turn count
        let index = this.zkapp.turns.get().toBigInt();

        if (index >= 2n) {
            const previousHitResult = this.zkapp.hitResult.get().toField();
            // update the off-chain hit tree from previous turn
            this.hitTree.setLeaf(index - 2n, previousHitResult); 

            // parse & update the local player hit results
            const parsedPreviousHitResult = Number(previousHitResult.toBigInt());
            this.playerHits.push(parsedPreviousHitResult);

            // fetch the previous player's target to point it with hit Result on the enemy grid
            let previousTarget = this.playerTargets[this.playerTargets.length - 1];

            if (parsedPreviousHitResult === 1) {
                this.playerHitCount++; 
                this.adversaryGridDisplay[previousTarget[1]][previousTarget[0]] = '\x1b[31mH\x1b[0m';
            }  else this.adversaryGridDisplay[previousTarget[1]][previousTarget[0]] = '\x1b[32mM\x1b[0m';   
        }

        // update the target Merkle Tree: previous turn
        this.targetTree.setLeaf(index - 1n, adversarySerializedTarget);

        let wTarget = this.targetTree.getWitness(index);
        let targetWitness = new TargetMerkleWitness(wTarget);

        let hTarget = this.hitTree.getWitness(index - 1n);
        let hitWitness = new HitMerkleWitness(hTarget);

        const serializedTarget = AttackUtils.serializeTarget(target);

        let attackTx = await Mina.transaction(this.playerAddress, () => {
            this.zkapp.attack(serializedTarget, this.serializedBoard, targetWitness, hitWitness);
        });

        await attackTx.prove();
        await attackTx.sign([this.playerKey]).send();

        // fetch the updated target on-chain
        const storedTarget = this.zkapp.target.get();

        // update the local off-chain target tree
        this.targetTree.setLeaf(index, storedTarget); 
        
        // store the player's choice locally
        this.playerTargets.push(target);
        this.adversaryGridDisplay[target[1]][target[0]] = '\x1b[34mT\x1b[0m\x1b[0m';

        // fetch the updated hit on-chain
        const storedHitResult = this.zkapp.hitResult.get().toField();

        // update the local off-chain hit tree
        this.hitTree.setLeaf(index -1n, storedHitResult); 

        // parse & update local state related to the adversary's hit result
        const parsedAdversaryHitResult = Number(storedHitResult.toBigInt());
        
        if (parsedAdversaryHitResult === 1) {
            this.adversaryHitCount++; 
            this.playerGridDisplay[adversaryTarget[1]][adversaryTarget[0]] = '\x1b[31mH\x1b[0m';
        } else  this.playerGridDisplay[adversaryTarget[1]][adversaryTarget[0]] = '\x1b[32mM\x1b[0m';

        this.winner = this.adversaryHitCount == 17; 
    }

    //TODO Integrate inside printGameData()
    printBoards() {
        let board1 = stringifyBoard(this.playerGridDisplay);
        let board2 = stringifyBoard(this.adversaryGridDisplay);
        printBoard(board1, board2);
    }

    //TODO Refactor
    printGameData() {
        function printHit(hit: number, playerId: Field, winnerId: bigint): string {
            let result;
            if (hit == 1) result = "Hit"; 
            else if (hit == 0) result = "Missed";
            else if (playerId.toBigInt() == winnerId) result = "Hit" 
            else result = "Pending"

            return result        
        }

        let turnCount = this.zkapp.turns.get().toNumber();
        let hitHistory = AttackUtils.deserializeHitHistory(this.zkapp.serializedHitHistory.get()).map(f => Number(f.toBigInt()));

        let winnerId: bigint;
        const hostId = this.zkapp.player1Id.get().toBigInt();
        const joinerId = this.zkapp.player2Id.get().toBigInt();

        if (hitHistory[0] === 17) winnerId = hostId;
        else if(hitHistory[1] === 17) winnerId = joinerId;

            
        let board1 = stringifyBoard(this.playerGridDisplay);
        let board2 = stringifyBoard(this.adversaryGridDisplay);
        printBoard(board1, board2);
        
        if (this.playerId.toBigInt() === hostId) {
            console.log('\x1b[35m%s\x1b[0m','\nPlayer1 is the host!');
            console.log('\x1b[36m%s\x1b[0m','Turn number: ', turnCount);
            console.log('\x1b[36m%s\x1b[0m','Address: ', this.playerAddress.toBase58());
            console.log('\x1b[36m%s\x1b[0m','Player ID: ', this.playerId.toBigInt());
            console.log('\x1b[36m%s\x1b[0m','Sucessful hits: ', this.playerHitCount);
            
            console.log('\x1b[36m%s\x1b[0m','Targeted shots: ');
            console.log(`Opening Target #1 --> [${this.playerTargets[0]}] --> ${printHit(this.playerHits[0], this.playerId, winnerId!)}`);
            for(let turn=1; turn< this.playerTargets.length; turn++) {
                console.log(`  Target #${turn+1} --> [${this.playerTargets[turn]}] --> ${printHit(this.playerHits[turn], this.playerId, winnerId!)}`)
            }
            
            if (this.winner) 
            console.log('\x1b[36m%s\x1b[0m','Winner: ', 'Player2');
            else if (this.playerId.toBigInt() == winnerId!)  
            console.log('\x1b[36m%s\x1b[0m', 'Winner: ','Player1');
            else 
            console.log('\x1b[36m%s\x1b[0m','No Winner yet!');
        }
        else {
            console.log('\x1b[35m%s\x1b[0m','\nPlayer2 is the joiner!');
            console.log('\x1b[36m%s\x1b[0m','Turn number: ', turnCount);
            console.log('\x1b[36m%s\x1b[0m','Address: ', this.playerAddress.toBase58());
            console.log('\x1b[36m%s\x1b[0m','Board Hash: ', joinerId);
            console.log('\x1b[36m%s\x1b[0m','Sucessful hits: ', this.playerHitCount);
            
            console.log('\x1b[36m%s\x1b[0m','Targeted shots: ');
            for(let turn=0; turn< this.playerTargets.length; turn++) {
                
                console.log(`  Target #${turn+1} --> [${this.playerTargets[turn]}] --> ${printHit(this.playerHits[turn], this.playerId, winnerId!)}`)
            }    
            if (this.winner) 
            console.log('\x1b[36m%s\x1b[0m','Winner: ', 'Player1');
            else if (this.playerId.toBigInt() == winnerId!)  
            console.log('\x1b[36m%s\x1b[0m', 'Winner: ','Player2');
            else 
            console.log('\x1b[36m%s\x1b[0m','No Winner yet!');
        }            
    }  
}