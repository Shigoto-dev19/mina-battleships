/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { 
    Field, 
    PublicKey,
    PrivateKey,
    MerkleTree,
    Mina,
} from 'o1js';
import { 
    BattleshipsZkApp,
    HitMerkleWitness, 
    TargetMerkleWitness 
} from './Battleships.js';
import {
    BoardUtils,
    AttackUtils,
} from './provableUtils.js';
import {
    PENDING_BLUE_SYMBOL,
    HIT_GREEN_SYMBOL,
    MISS_RED_SYMBOL,
    generateEmptyGameGrid,
    positionShipsOnGrid,
    stringifyGameGrid,
    printPlayerAndAdversaryBoards,
    printHitResult,
    parseCoordinates,
} from './displayUtils.js'

export { BattleShipsClient }

/**
 * The `BattleShipsClient` class acts as a convenient wrapper for players to interact with the Battleships zkapp
 * while also managing off-chain storage seamlessly.
 * 
 * Note: This class stores both player and adversary targets and hits. While all data can be fetched from the hit & target Merkle Tree,
 *       we update local class storage alongside the tree before and after sending a transaction to the zkapp. This ensures clarity and 
 *       redundancy in data storage.
 * 
 * In fact, all data can be fetched from the hit & target Merkle Trees based on storage index parity: even index for the host 
 * and odd index for the joiner.
 *
 * The Merkle Trees are crucial for proving to the zkapp that the player has not missed any storage for hits or targets,
 * and they act as a backup for game state storage. 
 * 
 * Storing data only locally(class) could lead to the collapse of the entire game state on the user interface if even a single value is missed, 
 * as the state gets continually updated in sequence with game progress.
 * 
 * Therefore, while it might seem redundant to store data in both the Merkle Trees and locally, it ensures the sustainability 
 * of the game data in case of errors or discrepancies.
 */
class BattleShipsClient {
    public zkapp: BattleshipsZkApp;

    private playerKey: PrivateKey;
    public playerAddress: PublicKey;
    public playerId: Field;

    private board: number[][];
    private serializedBoard: Field;

    private salt: Field;

    public playerTargets: number[][];
    public adversaryTargets: number[][];

    public playerHitCount: number;
    public adversaryHitCount: number;

    public targetTree: MerkleTree;
    public hitTree: MerkleTree;

    public playerGridDisplay: string[][];
    public adversaryGridDisplay: string[][];

    public playerHits: number[];
    
    constructor(
        zkapp: BattleshipsZkApp,
        playerKey: PrivateKey,
        board: number[][],
    ) {
        this.zkapp = zkapp;

        this.board = board;
        this.serializedBoard = BoardUtils.serialize(board);
        this.salt = Field.random();

        this.playerKey = playerKey;
        this.playerAddress = playerKey.toPublicKey();
        this.playerId = BoardUtils.generatePlayerId(this.serializedBoard, this.playerAddress, this.salt);

        this.playerTargets = [];
        this.adversaryTargets = [];
        
        this.playerHitCount = 0;
        this.adversaryHitCount = 0;

        this.targetTree = new MerkleTree(8);
        this.hitTree = new MerkleTree(8);

        this.playerGridDisplay = positionShipsOnGrid(this.board);
        this.adversaryGridDisplay = generateEmptyGameGrid();

        this.playerHits = [];
    }

    static initialize(zkapp: BattleshipsZkApp, playerKey: PrivateKey, board: number[][]) {
        return new BattleShipsClient(
            zkapp,
            playerKey,
            board,
        );
    }
    
    async hostGame() {
        const hostGameTx = await Mina.transaction(this.playerAddress, () => {
          this.zkapp.hostGame(this.serializedBoard, this.salt);
        });
        
        await hostGameTx.prove();
        await hostGameTx.sign([this.playerKey]).send();
    }

    async joinGame() {
        const joinGameTx = await Mina.transaction(this.playerAddress, () => {
          this.zkapp.joinGame(this.serializedBoard, this.salt);
        });
        
        await joinGameTx.prove();
        await joinGameTx.sign([this.playerKey]).send();
    }

    async playFirstTurn(firstTarget: number[]) {
        // The index of target merkle tree witness is the turn count
        const index = this.zkapp.turns.get();

        const w = this.targetTree.getWitness(index.toBigInt());
        const targetWitness = new TargetMerkleWitness(w);

        const serializedTarget = AttackUtils.serializeTarget(firstTarget);

        const firstTurnTx = await Mina.transaction(this.playerAddress, () => {
          this.zkapp.firstTurn(serializedTarget, this.serializedBoard, this.salt, targetWitness);
        });

        await firstTurnTx.prove();
        await firstTurnTx.sign([this.playerKey]).send();

        // Fetch the player target stored on-chain
        const storedTarget = this.zkapp.target.get();

        // Update the local off-chain target Merkle Tree
        this.targetTree.setLeaf(index.toBigInt(), storedTarget); 

        // Update class local storage and point target to the adversary's grid display
        this.playerTargets.push(firstTarget);
        this.adversaryGridDisplay[firstTarget[1]][firstTarget[0]] = PENDING_BLUE_SYMBOL;
    }

    async playTurn(target: number[]) {
        // Fetch the adversary target from the previous turn 
        const adversarySerializedTarget = this.zkapp.target.get();
        
        // Deserialize & update the local enemy target storage
        const adversaryTarget = AttackUtils.deserializeTarget(adversarySerializedTarget).map(f => Number(f.toBigInt()));
        this.adversaryTargets.push(adversaryTarget);
        
        // Fetch the last turn count
        const index = this.zkapp.turns.get().toBigInt();

        if (index >= 2n) {
            const previousHitResult = this.zkapp.hitResult.get().toField();
            // Update the off-chain hit Merkle Tree from the player's previous turn
            this.hitTree.setLeaf(index - 2n, previousHitResult); 

            // Parse & update the local player hit results
            const parsedPreviousHitResult = Number(previousHitResult.toBigInt());
            this.playerHits.push(parsedPreviousHitResult);

            // Fetch the previous player's target to point it with hit Result on the enemy grid
            const previousTarget = this.playerTargets[this.playerTargets.length - 1];

            if (parsedPreviousHitResult === 1) {
                this.playerHitCount++; 
                this.adversaryGridDisplay[previousTarget[1]][previousTarget[0]] = HIT_GREEN_SYMBOL;
            }  else this.adversaryGridDisplay[previousTarget[1]][previousTarget[0]] = MISS_RED_SYMBOL;   
        }

        // Update the target Merkle Tree: previous turn
        this.targetTree.setLeaf(index - 1n, adversarySerializedTarget);

        const wTarget = this.targetTree.getWitness(index);
        const targetWitness = new TargetMerkleWitness(wTarget);

        const hTarget = this.hitTree.getWitness(index - 1n);
        const hitWitness = new HitMerkleWitness(hTarget);

        const serializedTarget = AttackUtils.serializeTarget(target);

        const attackTx = await Mina.transaction(this.playerAddress, () => {
            this.zkapp.attack(serializedTarget, this.serializedBoard, this.salt, targetWitness, hitWitness);
        });

        await attackTx.prove();
        await attackTx.sign([this.playerKey]).send();

        // Fetch the updated target on-chain
        const storedTarget = this.zkapp.target.get();

        // Update the local off-chain target Merkle Tree
        this.targetTree.setLeaf(index, storedTarget); 
        
        // Store the player's target locally
        this.playerTargets.push(target);
        this.adversaryGridDisplay[target[1]][target[0]] = PENDING_BLUE_SYMBOL;

        // Fetch the updated hit on-chain
        const storedHitResult = this.zkapp.hitResult.get().toField();

        // Update the local off-chain hit Merkle Tree
        this.hitTree.setLeaf(index -1n, storedHitResult); 

        // Parse & update local state related to the adversary's hit result
        const parsedAdversaryHitResult = Number(storedHitResult.toBigInt());
        
        if (parsedAdversaryHitResult === 1) {
            this.adversaryHitCount++; 
            this.playerGridDisplay[adversaryTarget[1]][adversaryTarget[0]] = HIT_GREEN_SYMBOL;
        } else  this.playerGridDisplay[adversaryTarget[1]][adversaryTarget[0]] = MISS_RED_SYMBOL;
    }

    displayPlayerGrids() {
        const stringifiedPlayerGameGrid = stringifyGameGrid(this.playerGridDisplay);
        const stringifiedAdversaryGameGrid = stringifyGameGrid(this.adversaryGridDisplay);
        printPlayerAndAdversaryBoards(stringifiedPlayerGameGrid, stringifiedAdversaryGameGrid);
    }

    displayPlayerStats() {
        const turnCount = this.zkapp.turns.get().toNumber();
        const serializedHitHistory = this.zkapp.serializedHitHistory.get();
        const hitHistory = AttackUtils.deserializeHitHistory(serializedHitHistory)[0].map(f => Number(f.toBigInt()));

        
        const hostId = this.zkapp.player1Id.get().toBigInt();
        const joinerId = this.zkapp.player2Id.get().toBigInt();
        
        let winnerId: bigint;
        if (hitHistory[0] === 17) winnerId = hostId;
        else if(hitHistory[1] === 17) winnerId = joinerId;

        const PURPLE = '\x1b[35m%s\x1b[0m';
        const BLUE = '\x1b[36m%s\x1b[0m';
        const inBoldGreen = (msg: string) => `\x1b[1m\x1b[32m${msg}\x1b[0m`;
        const LINE = '-'.repeat(107);

        const isHost = this.playerId.toBigInt() === hostId;
        
        console.log(LINE);
        console.log(PURPLE, `${isHost ? 'Host' : 'Joiner'} - Player${isHost ? '1' : '2'} Game Stats`);
        console.log(LINE);
        console.log(BLUE, 'Turn Count:      ', turnCount);
        console.log(BLUE, 'MINA Address:    ', this.playerAddress.toBase58());
        console.log(BLUE, 'Player HEX ID:   ', this.playerId.toBigInt().toString(16));
        console.log(BLUE, 'Score:           ', `${this.playerHitCount} - ${this.adversaryHitCount}`);
        console.log(BLUE, `Targeted shots:  `, `${this.adversaryTargets.length === 0 ? 'None' : ''}`);
        for(let turn=0; turn < this.playerTargets.length; turn++) 
            console.log(`                  Target #${turn+1} --> ${parseCoordinates(this.playerTargets[turn])} --> ${printHitResult(this.playerHits[turn])}`);
        
        if (hostId === winnerId!) 
            console.log(BLUE, 'Winner: ', `         ${inBoldGreen('Host - Player1')}`);
        else if (joinerId == winnerId!)  
            console.log(BLUE, 'Winner: ', `         ${inBoldGreen('Joiner - Player2')}`);
        else 
            console.log(BLUE, 'No Winner yet!');
        console.log(LINE, '\n');
    }

    displayGameSummary() {
        this.displayPlayerGrids();
        this.displayPlayerStats();
    }  
}