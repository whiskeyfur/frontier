-- The upstream game's triggers on game_anthros (see its Game\Schema::migrate), by hand: SQLite has no BEFORE INSERT
-- triggers that set NEW's columns, so these fill them in just after the insert. The numbers come from constants in
-- upstream PHP (Anthros::LIFESPAN_MIN 52, LIFESPAN_MAX 80, FERTILE_UNTIL_WEEKS [47, 52] = 329..364 days,
-- OLD_AGE_WEEKS 20 = 140 days; Litters::MIN_CUBS 1, MAX_CUBS 8; Anthros' starting food 7 and coins 0..100):
-- keep them in step with src/game/Anthros.ts and src/game/Litters.ts.

-- game_anthro_fertile_weekday: a random day of the week a dam can conceive.
CREATE TRIGGER game_anthro_fertile_weekday AFTER INSERT ON game_anthros FOR EACH ROW WHEN NEW.fertile_weekday IS NULL
BEGIN
    UPDATE game_anthros SET fertile_weekday = 1 + FLOOR(RAND() * 7) WHERE id = NEW.id;
END;

-- game_anthro_max_cubs: her mother's, give or take one; or random, with no recorded mother.
CREATE TRIGGER game_anthro_max_cubs AFTER INSERT ON game_anthros FOR EACH ROW WHEN NEW.max_cubs IS NULL
BEGIN
    UPDATE game_anthros SET max_cubs = (
        SELECT CASE WHEN m.max_cubs IS NULL THEN 1 + FLOOR(RAND() * 8)
                    ELSE MIN(8, MAX(1, m.max_cubs + FLOOR(RAND() * 3) - 1)) END
        FROM (SELECT (SELECT max_cubs FROM game_anthros WHERE id = NEW.dam_id) AS max_cubs) m
    ) WHERE id = NEW.id;
END;

-- game_anthro_life: when she stops conceiving, then how long it lives (a dam at least OLD_AGE_WEEKS past that).
CREATE TRIGGER game_anthro_life AFTER INSERT ON game_anthros FOR EACH ROW
WHEN (NEW.fertile_until IS NULL AND NEW.birthdate IS NOT NULL) OR NEW.lifespan_weeks IS NULL
BEGIN
    UPDATE game_anthros SET fertile_until = ADDDATE(birthdate, 329 + FLOOR(RAND() * 36))
    WHERE id = NEW.id AND fertile_until IS NULL AND birthdate IS NOT NULL;
    UPDATE game_anthros SET lifespan_weeks = (
        SELECT s.shortest + FLOOR(RAND() * (MAX(80, s.shortest) - s.shortest + 1))
        FROM (
            SELECT CASE WHEN g.is_female AND a.fertile_until IS NOT NULL AND a.birthdate IS NOT NULL
                        THEN MAX(52, CEIL((DATEDIFF(a.fertile_until, a.birthdate) + 140) / 7.0))
                        ELSE 52 END AS shortest
            FROM game_anthros a LEFT JOIN game_genders g ON g.id = a.gender_id WHERE a.id = NEW.id
        ) s
    ) WHERE id = NEW.id AND lifespan_weeks IS NULL;
END;

-- game_anthro_starting_food: a week's food.
CREATE TRIGGER game_anthro_starting_food AFTER INSERT ON game_anthros FOR EACH ROW
BEGIN
    INSERT OR IGNORE INTO game_goods (anthro_id, good, quantity) VALUES (NEW.id, 'food', 7);
END;

-- game_anthro_starting_coins: a random starting balance, 0 to 100 coins, in the ledger too.
CREATE TRIGGER game_anthro_starting_coins AFTER INSERT ON game_anthros FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM game_wallets WHERE anthro_id = NEW.id)
BEGIN
    INSERT INTO game_wallets (anthro_id, balance) VALUES (NEW.id, FLOOR(RAND() * 101));
    INSERT INTO game_ledger (anthro_id, amount, balance_after, reason)
    SELECT anthro_id, balance, balance, 'Starting balance' FROM game_wallets WHERE anthro_id = NEW.id;
END;
