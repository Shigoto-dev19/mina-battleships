# Game Architecture Considerations

- Most of the game architecture considerations are a workaround to accommodate the Battleships game state within the confines of the allowed 8 field elements on-chain.

## Board

- Serialize board
- Hash board

## Player

### Player ID

- Initially the player was set as a struct(object) that contains:
    1. Player address(2 field elements)
    2. Player's board hash(1 field element)
- The player's address could be hash to fit one field but that's still not efficient due to the variety of game state storage variables.
- Such data structure makes it easy to exceed more than 8 pieces of state.
- Basically, we want to identify the player from his address `this.sender`.
- We also want to verify his board integrity when his scan his/her adversary's attack.
- **SOLUTION**: Combine both required arguments by hashing `[playerAddress,  board]`
    ==> The result is an argument called `playerId`.

### Game Host (player1)

- At the beginning the `hostGame` method used to accept any player who wants to host a game.
    1. The zkApp validates the board
    2. The zkApp calculates host ID
    3. Store the host ID on-chain
- The logic above is correct but it's missing a check.
    - What if someone calls the method `hostGame`.
        - Then the **hostID** stored on-chain can be updated if a meddler provides a valid board(ships placement).
        - This will mess up completely with the game order as every on-going state will refer to the new host(player1Id).
    - **SOLUTION:** 
        - Initialize `playerID` as `Field(0)`.
        - The `hostGame` now only updates the `hostID` if the initial ID stored on-chain is `Field(0)`.
        - This makes `hostGame` method callable only once.
        - This prevents other players to tamper with `hostID` of an ongoing game.


### Game Joiner (player2)

- For tracking whether the game is full or not, the battleships game state used to have a `Bool` variable called `joinable` that determines
whether a game is joinable or not. 
- This is unnecessary as game fullness can be traceable following if player1 & player2 IDs are already updated or not.
- The `joinable` variable used to prevent other players from tampering with the current joiner's ID stored on-chain.
    - Now similar to `hostGame` method
        1. before update, the `player2Id` is asserted to be `Field(0)`
        2. validate joiner board
        3. calculate joiner ID
        4. update on-chain player2Id(joiner)

## Attack

- Serialize attack target to fit one field state.
- Validate ships integrity check outside of the attack circuit
- Store hit history of a sequence of bits.
    - This is quite adequate regarding that a hit result is binary (1 if hit & 0 if missed).

### First Turn 

- The `firstTurn` method doesn't return an attack result or even use the player's board.
    - **NOTE:** The first method takes the player's board as an argument but that's only to generate and verify player's ID.
- Following the attack principle of the game:
    1. player should fetch his adversary's target on-chain
    2. scan it through his/her board off-chain
    3. store the adversary's hit result on-chain
- The game principle preserves players' board privacy but causes a delay of one turn to report the hit result to the adversary.
- Because this delay is inevitable, the first player(host) should only select his target store it on-chain to initiate the alternative attack sequence.
    
- The `firstTurn` method works as follows: 
    1. Assert that the game didn't start yet(this.turns === 0).
    2. Restrict access to the host(generate ID and verify).
    3. Validate that the host's target is in game map range.
        - NOTE: The attack method validates the target but having an invalid target at the first turn will require the host to replay the **first turn** which can mess up with the order of the game!
    4. Storage player's target on-chain.
    5. Increment turn counter.
    
## Feedback

- I realized that verifying code with `Provable.runAndCheck()` does not validate code provability.
    - This makes sense regarding that the method runs provable code without creating a proof.
    - Better check with `proofsEnable=true` when running zkapp on a local blockchain.