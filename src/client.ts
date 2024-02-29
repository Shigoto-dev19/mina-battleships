/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { 
    Field, 
    PublicKey,
    PrivateKey,
    MerkleTree,
    Mina,
} from 'o1js';
import { 
    Battleships,
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

        this.playerGridDisplay = positionShipsOnGrid(this.board);
        this.adversaryGridDisplay = generateEmptyGameGrid();

        this.playerHits = [];
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
        this.adversaryGridDisplay[firstTarget[1]][firstTarget[0]] = PENDING_BLUE_SYMBOL;
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
                this.adversaryGridDisplay[previousTarget[1]][previousTarget[0]] = HIT_GREEN_SYMBOL;
            }  else this.adversaryGridDisplay[previousTarget[1]][previousTarget[0]] = MISS_RED_SYMBOL;   
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
        this.adversaryGridDisplay[target[1]][target[0]] = PENDING_BLUE_SYMBOL;

        // fetch the updated hit on-chain
        const storedHitResult = this.zkapp.hitResult.get().toField();

        // update the local off-chain hit tree
        this.hitTree.setLeaf(index -1n, storedHitResult); 

        // parse & update local state related to the adversary's hit result
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
        for(let turn=0; turn< this.playerTargets.length; turn++) 
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