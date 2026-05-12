I want to add an extra feature called auto pilot zen mode,
a hidden trigger for widget is ` on keyboard, better yet  🦂 is added in header as logo and the hidden feature is triggered when this logo is clicked 5 times consecutively 
what this widget will do
make a menu with options of auto play, get initial deck suffled and seed, get current deck state,
in won games we know for sure that this game is playable to a win state
as some shuffled deck muffle some key cards in hidden and a bad end is reached where u need hidden cards to uncover the hidden cards and game is just impossible to win 
to avoid these games i want to set up and test various games and aquire a solvable level set where shuffled decks when drawn always have this win case

what the auto play will do is check for possible movements, score them and apply move,
undo is considered as a move, and illegal moves may not be used
since the covered cards are known by system, a calculator should predict an eventually "dead end" before the auto game begin, 
in auto pilot there will be play till paused and play single buttons, a pause button will temporarly stop auto game, resume will be available using that same button
in auto pilot as i want it as a zen mode for relaxing view of game i want some cool animated movement of each action, also a log of moves need to be logged
the undo can be used but for limited time so no infinity moves happen
when some unwise case occur where the next move will result in a game over undo can be used till game reset, states where that scenario is stored so it will not go there again, game will keep going till a dead end is reached in every possible scenario

for example a new game is started and auto pilot is enabled
user click auto play 
system will check for possible moves and score them, go with first one
animate the action moving the cards pile and new board is now available
now get possible moves and score and use first
after few moves no legal moves exist but extra set is not used so it is used then
then possible moves are available rank use first for few moves
a bad scenario where there is hard to break column exist like the need to one card breaking the column exist within and nothing can be done to solve, then undo will take place untill this no longer occuring and scenario will resume forward, deciding that having a column where it is impossible to break is illegal to be used
what impossible to break mean a column with Ah and 2h, but the 5h and 4h have a 5s between them, to move the 5s a 6s is needed, under 5s happen to also have 7s, if another column have 6s and is moved to this pile, 5s is now impossible to be moved, that is when all key cards to move a pile exist in same column

when a  game is won and auto pilot is enabled an analysis is made, deck is available for view (what a deck is like format 5G 10R 13B 2G 6Y ....) where the colors are the suits RGBY and numbers are the card numbers this deck is solvable based on
- no hunger hidden cards detected (hidden cards can be reveald in at least one case of playing)
- the pilot was able to win the game
- a game was won by player
a downlodable deck combination is then available with seed as file name

