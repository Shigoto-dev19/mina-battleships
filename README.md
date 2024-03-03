# Mina ZK Battleships

## Basic Game Description


### Game Definition

- [Battleships](https://en.wikipedia.org/wiki/Battleship_(game)) (also known as **Sea Battle**) is a strategy-type guessing game for two players.
- It is played on ruled grids (paper or board) on which each player's fleet of warships is marked.
- The locations of the fleets are **concealed** from the other player.
- Players alternate turns calling "shots" at the other player's ships, and the objective of the game is to destroy the opposing player's fleet.

- The paper/board game is played on four grids, two for each player.

- The grids are typically square – usually **10×10** – and the individual squares in the grid are identified by letter and number.

- On one grid the player arranges ships and records the shots by the opponent. On the other grid, the player records their own shots.

![alt text](./images/battleships-board.png)

### Setup 
- Before play begins, each player secretly arranges their ships on their primary grid. Each ship occupies a number of consecutive squares on the grid, arranged either horizontally or vertically.
- The number of squares for each ship is determined by the type of ship. The ships cannot overlap (i.e., only one ship can occupy any given square in the grid).
- The types and numbers of ships allowed are the same for each player.
    
    | No. | Class of ship | Size |
    | --- | ---           | ---  |
    | 1   | carrier       | 5    |
    | 2   | cruiser       | 4    |
    | 3   | destroyer     | 3    |
    | 4   | submarine     | 3    |
    | 5   | patrol  boat  | 2    |

![alt text](./images/ship-placement.png)

- These may vary depending on the rules. The ships should be hidden from the player’s sight and it's not allowed to see each other's pieces.
- The game is a discovery game in which players need to discover their opponent's ship positions.

### Motivation:
- A fundamental element of the game is that it involves “trust” between the players.
- The game assumes that each player honestly announces if the shot has successfully hit his/her own ship.
- Given that the game is traditionally held physically between two players, they can reconcile each other’s “shot” records at the end of the game, so it is not too bad.
- However, if the game is held remotely (e.g. internet), the assumption of trust would not work well, especially if the players want to bet money on a win.
- When building a Battleships game as a **web application**, the obvious implementation is that the actual ship deployment is stored in the web server, and the verification of whether the ships get hit or not is also performed by the web server, which is indeed centralized and trusted by all players 😟.

### Solution:
- Moving the implementation to be decentralized as a peer-to-peer game (or Dapp) is a noteworthy solution to involve money in games as well as eliminating trust between players or any other centralized authority.

- The Mina blockchain, with its unique design centered around succinct blockchain technology, offers several features that can contribute to developing a trustless and private Battleships game:
    - **Decentralization**: Mina blockchain is decentralized, meaning that no single entity has control over the network. This decentralization ensures that the Battleships game can operate in a trustless manner, without relying on a centralized authority to manage game logic or verify transactions. Players can participate in Battleships games directly on the Mina blockchain, knowing that the game is governed by transparent and immutable smart contracts(zkapp).

    - Mina **zk-SNARKs Integration** enables privacy-preserving transactions. With zk-SNARKs, users can prove the validity of transactions without revealing any sensitive information, such as the player's game board configuration.

    - **Succinctness**: Mina blockchain is designed to maintain a constant-size blockchain regardless of the transaction volume or history. For a Battleships game, this means that the game state and transaction history remain lightweight and easily verifiable by all participants.


## How to build

```sh
npm run build
```

## How to run tests
```sh
npm run test
npm run testw # watch mode
```

## How to run coverage

```sh
npm run coverage
```

## License

[Apache-2.0](LICENSE)
