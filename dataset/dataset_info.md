About Dataset
League of Legends Relational Database for Match Prediction
Context

This dataset contains detailed match and player data from League of Legends, one of the most popular multiplayer online battle arena (MOBA) games in the world. It includes 270,000+ matches and contains 900,000+ summoner statistics, capturing a wide range of in-game statistics, such as champion selection, player performance metrics, match outcomes, and more.

The dataset is structured to support a variety of analyses, including:

    Predicting match outcomes based on team compositions and player stats
    Evaluating player performance and progression over time
    Exploring trends in champion popularity and win rates
    Building machine learning models for esports analytics

Whether you are interested in competitive gaming, data science, or predictive modeling, this dataset provides a rich source of structured data to explore the dynamics of League of Legends at scale.
Data Schema and Dictionary

Data was collected from Riot Games API using Python script(link) from Patch 25.19

The datase consists of 7 csv files:

    MatchStatsTbl - Match Stats given a summonerID and MatchID.Contains K/D/A, Items, Runes,Ward Score, Summoner Spells, Baron Kills, Dragon Kills, Lane, DmgTaken/Dealt, Total Gold, cs,Mastery Points and Win/Loss
    TeamMatchStatsTbl - Containes Red/Blue Champions,Red/Blue BaronKills,Blue/Red Turret Kills, Red/Blue Kills, RiftHearaldKills and Win/loss
    MatchTbl- Contains MatchID,Rank,Match Duration and MatchType.
    RankTbl - Contains RankID and RankName
    ChampionTbl- Contains ChampionID and ChampionName
    ItemTbl - Contains ItemID and ItemName
    SummonerTbl - Contains SummonerID and SummonerName
    SummonerMatchTbl - Links MatchID,SummonerID and ChampionID

Database Features

    This dataset contains 270,000+ League of Legends matches and 900,000+ summoner statistics from those games.
    Uses Data from over 24,000+ summoners.
    Consists of Data from Europe and NA and Asia
    Data is sampled from Unranked to Challenger tiers.

Database Setup

-MySQL Database using Linux
-Database Schema Script can be found here. (Works with the gtihub project to collect your own data)
Limitations

The Riot API only provides the "BOTTOM" lane for bot-lane players.
During Data collection, roles were inferred by combining chapions that often played support with CS metrics to distinguish ADC vs Support — especially for ambiguous picks like Senna or off-meta choices.

Source: https://www.kaggle.com/datasets/nathansmallcalder/lol-match-history-and-summoner-data-80k-matches/data
