from sqlalchemy import Column, String, Integer, Float, Boolean, ForeignKey, DateTime, JSON, BigInteger, Index
from sqlalchemy.orm import relationship
from database import Base
import datetime

class User(Base):
    __tablename__ = "users"

    puuid = Column(String, primary_key=True, index=True)
    game_name = Column(String, index=True)
    tag_line = Column(String, index=True)
    region = Column(String)
    profile_icon_id = Column(Integer)
    summoner_level = Column(Integer)
    last_updated = Column(DateTime, default=datetime.datetime.utcnow)

class Match(Base):
    __tablename__ = "matches"

    match_id = Column(String, primary_key=True, index=True)
    platform_id = Column(String)
    game_creation = Column(BigInteger, index=True)  # Index for ORDER BY game_creation DESC
    game_duration = Column(Integer)
    game_version = Column(String)
    queue_id = Column(Integer)
    data = Column(JSON)

    participants = relationship("Participant", back_populates="match", cascade="all, delete-orphan")

class Participant(Base):
    __tablename__ = "participants"
    __table_args__ = (
        Index('idx_participant_puuid_match', 'puuid', 'match_id'),  # Composite index for common JOINs
    )
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    match_id = Column(String, ForeignKey("matches.match_id"))
    puuid = Column(String, index=True)
    
    # Core stats for ML
    champion_id = Column(Integer)
    team_id = Column(Integer)
    win = Column(Boolean)
    
    kills = Column(Integer)
    deaths = Column(Integer)
    assists = Column(Integer)
    
    # ML Features
    gold_per_minute = Column(Float)
    total_minions_killed = Column(Integer)
    vision_score = Column(Float)
    damage_dealt_to_champions = Column(Integer)
    
    # Store other relevant stats as JSON to avoid 100 columns if schema changes
    stats_json = Column(JSON)
    
    match = relationship("Match", back_populates="participants")

