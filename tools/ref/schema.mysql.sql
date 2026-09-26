/*M!999999\- enable the sandbox mode */ 
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_anthro_skills` (
  `anthro_id` int(10) unsigned NOT NULL,
  `skill_id` int(10) unsigned NOT NULL,
  `practice` int(10) unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`anthro_id`,`skill_id`),
  KEY `skill_id` (`skill_id`),
  CONSTRAINT `game_anthro_skills_ibfk_1` FOREIGN KEY (`anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE CASCADE,
  CONSTRAINT `game_anthro_skills_ibfk_2` FOREIGN KEY (`skill_id`) REFERENCES `game_skills` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_anthros` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `owner_id` int(10) unsigned DEFAULT NULL,
  `player_id` int(10) unsigned DEFAULT NULL,
  `name` varchar(64) NOT NULL,
  `gender_id` int(10) unsigned NOT NULL,
  `species_id` int(10) unsigned DEFAULT NULL,
  `birthdate` date DEFAULT NULL,
  `fertile_on` date DEFAULT NULL,
  `fertile_until` date DEFAULT NULL,
  `sire_id` int(10) unsigned DEFAULT NULL,
  `dam_id` int(10) unsigned DEFAULT NULL,
  `breeding_id` int(10) unsigned DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `fertile_weekday` tinyint(3) unsigned DEFAULT NULL,
  `max_cubs` tinyint(3) unsigned DEFAULT NULL,
  `urge_rise` tinyint(3) unsigned DEFAULT NULL,
  `debt` bigint(20) DEFAULT NULL,
  `debt_rate` bigint(20) NOT NULL DEFAULT 0,
  `debt_since` datetime DEFAULT NULL,
  `title_rank` tinyint(3) unsigned DEFAULT NULL,
  `title_since` datetime DEFAULT NULL,
  `liege_id` int(10) unsigned DEFAULT NULL,
  `wage` bigint(20) DEFAULT NULL,
  `hire_breedable` tinyint(1) NOT NULL DEFAULT 1,
  `employer_id` int(10) unsigned DEFAULT NULL,
  `employed_wage` bigint(20) DEFAULT NULL,
  `employed_since` datetime DEFAULT NULL,
  `paid_until` date DEFAULT NULL,
  `lifespan_weeks` smallint(5) unsigned DEFAULT NULL,
  `died_at` datetime DEFAULT NULL,
  `young` tinyint(1) NOT NULL DEFAULT 0,
  `spouse_of` int(10) unsigned DEFAULT NULL,
  `title_by_land` tinyint(1) NOT NULL DEFAULT 0,
  `granted_rank` tinyint(3) unsigned DEFAULT NULL,
  `tax_rate` tinyint(3) unsigned DEFAULT NULL,
  `tax_balance` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tax_overdue_since` date DEFAULT NULL,
  `trade_occupation_id` int(10) unsigned DEFAULT NULL,
  `seeking_occupation_id` int(10) unsigned DEFAULT NULL,
  `hungry_on` date DEFAULT NULL,
  `standard_schedule_id` int(10) unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `player_id` (`player_id`),
  KEY `owner_id` (`owner_id`,`name`),
  KEY `gender_id` (`gender_id`),
  KEY `species_id` (`species_id`),
  KEY `sire_id` (`sire_id`),
  KEY `dam_id` (`dam_id`),
  KEY `liege_id` (`liege_id`),
  KEY `employer_id` (`employer_id`),
  KEY `breeding_id` (`breeding_id`),
  KEY `died_at` (`died_at`),
  KEY `spouse_of` (`spouse_of`),
  KEY `trade_occupation_id` (`trade_occupation_id`),
  KEY `seeking_occupation_id` (`seeking_occupation_id`),
  KEY `standard_schedule_id` (`standard_schedule_id`),
  CONSTRAINT `game_anthros_ibfk_10` FOREIGN KEY (`breeding_id`) REFERENCES `game_breedings` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_anthros_ibfk_11` FOREIGN KEY (`spouse_of`) REFERENCES `game_anthros` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_anthros_ibfk_12` FOREIGN KEY (`trade_occupation_id`) REFERENCES `game_occupations` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_anthros_ibfk_13` FOREIGN KEY (`seeking_occupation_id`) REFERENCES `game_occupations` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_anthros_ibfk_14` FOREIGN KEY (`standard_schedule_id`) REFERENCES `game_standard_schedules` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_anthros_ibfk_15` FOREIGN KEY (`owner_id`) REFERENCES `game_anthros` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_anthros_ibfk_16` FOREIGN KEY (`employer_id`) REFERENCES `game_anthros` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_anthros_ibfk_2` FOREIGN KEY (`gender_id`) REFERENCES `game_genders` (`id`),
  CONSTRAINT `game_anthros_ibfk_3` FOREIGN KEY (`species_id`) REFERENCES `game_species` (`id`),
  CONSTRAINT `game_anthros_ibfk_4` FOREIGN KEY (`sire_id`) REFERENCES `game_anthros` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_anthros_ibfk_5` FOREIGN KEY (`dam_id`) REFERENCES `game_anthros` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_anthros_ibfk_7` FOREIGN KEY (`liege_id`) REFERENCES `game_anthros` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_anthros_ibfk_9` FOREIGN KEY (`player_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`whiskey`@`localhost`*/ /*!50003 TRIGGER game_anthro_fertile_weekday BEFORE INSERT ON game_anthros FOR EACH ROW
             SET NEW.fertile_weekday = IFNULL(NEW.fertile_weekday, 1 + FLOOR(RAND() * 7)) */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`whiskey`@`localhost`*/ /*!50003 TRIGGER game_anthro_max_cubs BEFORE INSERT ON game_anthros FOR EACH ROW
             BEGIN
                 DECLARE mothers TINYINT UNSIGNED DEFAULT NULL;
                 IF NEW.max_cubs IS NULL THEN
                     IF NEW.dam_id IS NOT NULL THEN
                         SELECT max_cubs INTO mothers FROM game_anthros WHERE id = NEW.dam_id;
                     END IF;
                     SET NEW.max_cubs = IF(mothers IS NULL,
                         1 + FLOOR(RAND() * 8),
                         LEAST(8, GREATEST(1, CAST(mothers AS SIGNED) + FLOOR(RAND() * 3) - 1)));
                 END IF;
             END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`whiskey`@`localhost`*/ /*!50003 TRIGGER game_anthro_life BEFORE INSERT ON game_anthros FOR EACH ROW
             BEGIN
                 DECLARE carries BOOLEAN DEFAULT FALSE;
                 DECLARE shortest SMALLINT DEFAULT 52;
                 IF NEW.fertile_until IS NULL AND NEW.birthdate IS NOT NULL THEN
                     SET NEW.fertile_until = NEW.birthdate + INTERVAL (329 + FLOOR(RAND() * 36)) DAY;
                 END IF;
                 IF NEW.lifespan_weeks IS NULL THEN
                     SELECT is_female INTO carries FROM game_genders WHERE id = NEW.gender_id;
                     IF carries AND NEW.fertile_until IS NOT NULL AND NEW.birthdate IS NOT NULL THEN
                         SET shortest = GREATEST(52, CEIL((DATEDIFF(NEW.fertile_until, NEW.birthdate) + 140) / 7));
                     END IF;
                     SET NEW.lifespan_weeks = shortest + FLOOR(RAND() * (GREATEST(80, shortest) - shortest + 1));
                 END IF;
             END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`whiskey`@`localhost`*/ /*!50003 TRIGGER game_anthro_starting_food AFTER INSERT ON game_anthros FOR EACH ROW
             INSERT IGNORE INTO game_goods (anthro_id, good, quantity) VALUES (NEW.id, 'food', 7) */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`whiskey`@`localhost`*/ /*!50003 TRIGGER game_anthro_starting_coins AFTER INSERT ON game_anthros FOR EACH ROW
             BEGIN
                 DECLARE coins BIGINT DEFAULT 0 + FLOOR(RAND() * 101);
                 IF NOT EXISTS (SELECT 1 FROM game_wallets WHERE anthro_id = NEW.id) THEN
                     INSERT INTO game_wallets (anthro_id, balance) VALUES (NEW.id, coins);
                     INSERT INTO game_ledger (anthro_id, amount, balance_after, reason)
                     VALUES (NEW.id, coins, coins, 'Starting balance');
                 END IF;
             END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_auctions` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `anthro_id` int(10) unsigned DEFAULT NULL,
  `anthro_name` varchar(64) NOT NULL,
  `seller_id` int(10) unsigned DEFAULT NULL,
  `seller_anthro_id` int(10) unsigned DEFAULT NULL,
  `starting_bid` bigint(20) NOT NULL,
  `buy_now` bigint(20) DEFAULT NULL,
  `ends_at` datetime NOT NULL,
  `status` enum('open','sold','unsold','cancelled') NOT NULL DEFAULT 'open',
  `winner_id` int(10) unsigned DEFAULT NULL,
  `final_price` bigint(20) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `closed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `status` (`status`,`ends_at`),
  KEY `anthro_id` (`anthro_id`),
  KEY `seller_id` (`seller_id`),
  KEY `winner_id` (`winner_id`),
  KEY `seller_anthro_id` (`seller_anthro_id`),
  CONSTRAINT `game_auctions_ibfk_1` FOREIGN KEY (`anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_auctions_ibfk_2` FOREIGN KEY (`seller_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_auctions_ibfk_3` FOREIGN KEY (`winner_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_auctions_ibfk_4` FOREIGN KEY (`seller_anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_baronies` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(64) NOT NULL,
  `holder_anthro_id` int(10) unsigned DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`),
  KEY `holder_anthro_id` (`holder_anthro_id`),
  CONSTRAINT `game_baronies_ibfk_1` FOREIGN KEY (`holder_anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_barony_parts` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `barony_id` int(10) unsigned NOT NULL,
  `name` varchar(64) NOT NULL,
  `kind` enum('village','town','city','expanse','manor') NOT NULL,
  `manager_anthro_id` int(10) unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `barony_id` (`barony_id`,`name`),
  KEY `manager_anthro_id` (`manager_anthro_id`),
  CONSTRAINT `game_barony_parts_ibfk_1` FOREIGN KEY (`barony_id`) REFERENCES `game_baronies` (`id`) ON DELETE CASCADE,
  CONSTRAINT `game_barony_parts_ibfk_2` FOREIGN KEY (`manager_anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_bids` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `auction_id` int(10) unsigned NOT NULL,
  `bidder_id` int(10) unsigned DEFAULT NULL,
  `anthro_id` int(10) unsigned DEFAULT NULL,
  `amount` bigint(20) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `auction_id` (`auction_id`,`amount`),
  KEY `bidder_id` (`bidder_id`),
  KEY `anthro_id` (`anthro_id`),
  CONSTRAINT `game_bids_ibfk_1` FOREIGN KEY (`auction_id`) REFERENCES `game_auctions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `game_bids_ibfk_2` FOREIGN KEY (`bidder_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_bids_ibfk_3` FOREIGN KEY (`anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_breeding_groups` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(64) NOT NULL,
  `owner_anthro_id` int(10) unsigned DEFAULT NULL,
  `access` enum('open','request','invite','closed','private') NOT NULL DEFAULT 'closed',
  `created_by` int(10) unsigned DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `rolled_through` date DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `created_by` (`created_by`),
  KEY `owner_anthro_id` (`owner_anthro_id`),
  CONSTRAINT `game_breeding_groups_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_breeding_groups_ibfk_2` FOREIGN KEY (`owner_anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_breedings` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `sire_id` int(10) unsigned DEFAULT NULL,
  `dam_id` int(10) unsigned DEFAULT NULL,
  `litter_id` int(10) unsigned DEFAULT NULL,
  `bred_at` datetime NOT NULL DEFAULT current_timestamp(),
  `bred_by` int(10) unsigned DEFAULT NULL,
  `owner_id` int(10) unsigned DEFAULT NULL,
  `forced` tinyint(1) NOT NULL DEFAULT 0,
  `barren_reason` varchar(255) DEFAULT NULL,
  `group_id` int(10) unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `sire_id` (`sire_id`),
  KEY `dam_id` (`dam_id`),
  KEY `bred_by` (`bred_by`),
  KEY `litter_id` (`litter_id`),
  KEY `group_id` (`group_id`),
  KEY `owner_id` (`owner_id`),
  CONSTRAINT `game_breedings_ibfk_1` FOREIGN KEY (`sire_id`) REFERENCES `game_anthros` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_breedings_ibfk_2` FOREIGN KEY (`dam_id`) REFERENCES `game_anthros` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_breedings_ibfk_3` FOREIGN KEY (`bred_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_breedings_ibfk_4` FOREIGN KEY (`litter_id`) REFERENCES `game_litters` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_breedings_ibfk_5` FOREIGN KEY (`owner_id`) REFERENCES `game_anthros` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_building_types` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(40) NOT NULL,
  `days` int(10) unsigned NOT NULL,
  `acres` decimal(10,2) NOT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_buildings` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `type_id` int(10) unsigned NOT NULL,
  `parcel_id` int(10) unsigned NOT NULL,
  `progress` int(10) unsigned NOT NULL DEFAULT 0,
  `started_by` int(10) unsigned DEFAULT NULL,
  `started_at` datetime NOT NULL DEFAULT current_timestamp(),
  `finished_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `parcel_id` (`parcel_id`),
  KEY `type_id` (`type_id`),
  KEY `started_by` (`started_by`),
  CONSTRAINT `game_buildings_ibfk_1` FOREIGN KEY (`type_id`) REFERENCES `game_building_types` (`id`),
  CONSTRAINT `game_buildings_ibfk_2` FOREIGN KEY (`parcel_id`) REFERENCES `game_parcels` (`id`) ON DELETE CASCADE,
  CONSTRAINT `game_buildings_ibfk_3` FOREIGN KEY (`started_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_daily` (
  `day` date NOT NULL,
  `task` varchar(20) NOT NULL,
  PRIMARY KEY (`day`,`task`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_fief_offers` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `kind` enum('grant','rate') NOT NULL,
  `lord_id` int(10) unsigned NOT NULL,
  `vassal_id` int(10) unsigned NOT NULL,
  `parcel_id` int(10) unsigned DEFAULT NULL,
  `acres` decimal(10,2) DEFAULT NULL,
  `rate` tinyint(3) unsigned NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `lord_id` (`lord_id`),
  KEY `vassal_id` (`vassal_id`),
  KEY `parcel_id` (`parcel_id`),
  CONSTRAINT `game_fief_offers_ibfk_1` FOREIGN KEY (`lord_id`) REFERENCES `game_anthros` (`id`) ON DELETE CASCADE,
  CONSTRAINT `game_fief_offers_ibfk_2` FOREIGN KEY (`vassal_id`) REFERENCES `game_anthros` (`id`) ON DELETE CASCADE,
  CONSTRAINT `game_fief_offers_ibfk_3` FOREIGN KEY (`parcel_id`) REFERENCES `game_parcels` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_flirts` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `from_anthro_id` int(10) unsigned NOT NULL,
  `to_anthro_id` int(10) unsigned NOT NULL,
  `message` varchar(255) DEFAULT NULL,
  `times` tinyint(3) unsigned NOT NULL DEFAULT 1,
  `status` enum('pending','accepted','declined','withdrawn') NOT NULL DEFAULT 'pending',
  `litter` tinyint(1) NOT NULL DEFAULT 0,
  `barren_reason` varchar(255) DEFAULT NULL,
  `created_by` int(10) unsigned DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `answered_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `to_anthro_id` (`to_anthro_id`,`status`),
  KEY `from_anthro_id` (`from_anthro_id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `game_flirts_ibfk_1` FOREIGN KEY (`from_anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE CASCADE,
  CONSTRAINT `game_flirts_ibfk_2` FOREIGN KEY (`to_anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE CASCADE,
  CONSTRAINT `game_flirts_ibfk_3` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_genders` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(64) NOT NULL,
  `is_male` tinyint(1) NOT NULL DEFAULT 0,
  `is_female` tinyint(1) NOT NULL DEFAULT 0,
  `presents_as` enum('male','female','androgynous') NOT NULL,
  `birth_weight` int(10) unsigned NOT NULL DEFAULT 0,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_goods` (
  `anthro_id` int(10) unsigned NOT NULL,
  `good` varchar(20) NOT NULL,
  `quantity` bigint(20) NOT NULL DEFAULT 0,
  PRIMARY KEY (`anthro_id`,`good`),
  CONSTRAINT `game_goods_ibfk_1` FOREIGN KEY (`anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_group_members` (
  `group_id` int(10) unsigned NOT NULL,
  `anthro_id` int(10) unsigned NOT NULL,
  `joined_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`group_id`,`anthro_id`),
  KEY `anthro_id` (`anthro_id`),
  CONSTRAINT `game_group_members_ibfk_1` FOREIGN KEY (`group_id`) REFERENCES `game_breeding_groups` (`id`) ON DELETE CASCADE,
  CONSTRAINT `game_group_members_ibfk_2` FOREIGN KEY (`anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_group_requests` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `group_id` int(10) unsigned NOT NULL,
  `anthro_id` int(10) unsigned NOT NULL,
  `kind` enum('request','invite') NOT NULL,
  `created_by` int(10) unsigned DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `group_id` (`group_id`,`anthro_id`),
  KEY `anthro_id` (`anthro_id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `game_group_requests_ibfk_1` FOREIGN KEY (`group_id`) REFERENCES `game_breeding_groups` (`id`) ON DELETE CASCADE,
  CONSTRAINT `game_group_requests_ibfk_2` FOREIGN KEY (`anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE CASCADE,
  CONSTRAINT `game_group_requests_ibfk_3` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_land_listings` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `parcel_id` int(10) unsigned NOT NULL,
  `acres` decimal(10,2) NOT NULL,
  `from_game` tinyint(1) NOT NULL DEFAULT 0,
  `seller_anthro_id` int(10) unsigned DEFAULT NULL,
  `price` bigint(20) NOT NULL,
  `status` enum('open','sold','cancelled') NOT NULL DEFAULT 'open',
  `buyer_anthro_id` int(10) unsigned DEFAULT NULL,
  `created_by` int(10) unsigned DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `closed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `status` (`status`),
  KEY `parcel_id` (`parcel_id`,`status`),
  KEY `seller_anthro_id` (`seller_anthro_id`),
  KEY `buyer_anthro_id` (`buyer_anthro_id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `game_land_listings_ibfk_1` FOREIGN KEY (`parcel_id`) REFERENCES `game_parcels` (`id`) ON DELETE CASCADE,
  CONSTRAINT `game_land_listings_ibfk_2` FOREIGN KEY (`seller_anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_land_listings_ibfk_3` FOREIGN KEY (`buyer_anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_land_listings_ibfk_4` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_ledger` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `anthro_id` int(10) unsigned NOT NULL,
  `amount` bigint(20) NOT NULL,
  `balance_after` bigint(20) NOT NULL,
  `reason` varchar(255) NOT NULL,
  `auction_id` int(10) unsigned DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `created_by` int(10) unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `anthro_id` (`anthro_id`,`id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `game_ledger_ibfk_1` FOREIGN KEY (`anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE CASCADE,
  CONSTRAINT `game_ledger_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_litters` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `dam_id` int(10) unsigned NOT NULL,
  `bred_on` date NOT NULL,
  `due_on` date NOT NULL,
  `born_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `dam_id` (`dam_id`),
  KEY `born_at` (`born_at`,`due_on`),
  CONSTRAINT `game_litters_ibfk_1` FOREIGN KEY (`dam_id`) REFERENCES `game_anthros` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_market_goods` (
  `good` varchar(20) NOT NULL,
  `name` varchar(40) NOT NULL,
  `buy_price` int(10) unsigned DEFAULT NULL,
  `sell_price` int(10) unsigned DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `edible` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`good`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_names` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(64) NOT NULL,
  `is_male` tinyint(1) NOT NULL DEFAULT 0,
  `is_female` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=601 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_notifications` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `anthro_id` int(10) unsigned DEFAULT NULL,
  `user_id` int(10) unsigned DEFAULT NULL,
  `kind` enum('system','message') NOT NULL DEFAULT 'system',
  `from_anthro_id` int(10) unsigned DEFAULT NULL,
  `body` text NOT NULL,
  `link` varchar(255) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `read_at` datetime DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  `deleted_by` int(10) unsigned DEFAULT NULL,
  `sent_by` int(10) unsigned DEFAULT NULL,
  `times` int(10) unsigned NOT NULL DEFAULT 1,
  `group_key` char(40) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `anthro_id` (`anthro_id`,`read_at`),
  KEY `user_id` (`user_id`,`read_at`),
  KEY `from_anthro_id` (`from_anthro_id`),
  KEY `deleted_by` (`deleted_by`),
  KEY `sent_by` (`sent_by`),
  KEY `notification_squash` (`anthro_id`,`group_key`),
  KEY `notification_squash_user` (`user_id`,`group_key`),
  CONSTRAINT `game_notifications_ibfk_1` FOREIGN KEY (`anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE CASCADE,
  CONSTRAINT `game_notifications_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `game_notifications_ibfk_3` FOREIGN KEY (`from_anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_notifications_ibfk_4` FOREIGN KEY (`deleted_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_notifications_ibfk_5` FOREIGN KEY (`sent_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_occupations` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(40) NOT NULL,
  `skill_id` int(10) unsigned NOT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `era` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `title` (`title`,`skill_id`),
  KEY `skill_id` (`skill_id`),
  CONSTRAINT `game_occupations_ibfk_1` FOREIGN KEY (`skill_id`) REFERENCES `game_skills` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=71 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_parcels` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `anthro_id` int(10) unsigned DEFAULT NULL,
  `acres` decimal(10,2) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `barony_id` int(10) unsigned DEFAULT NULL,
  `part_id` int(10) unsigned DEFAULT NULL,
  `held_of` int(10) unsigned DEFAULT NULL,
  `tenure` varchar(255) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  KEY `anthro_id` (`anthro_id`),
  KEY `barony_id` (`barony_id`),
  KEY `part_id` (`part_id`),
  KEY `held_of` (`held_of`),
  CONSTRAINT `game_parcels_ibfk_1` FOREIGN KEY (`anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_parcels_ibfk_2` FOREIGN KEY (`barony_id`) REFERENCES `game_baronies` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_parcels_ibfk_3` FOREIGN KEY (`part_id`) REFERENCES `game_barony_parts` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_parcels_ibfk_4` FOREIGN KEY (`held_of`) REFERENCES `game_anthros` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_preferences` (
  `user_id` int(10) unsigned NOT NULL,
  `era` varchar(20) NOT NULL DEFAULT 'dark',
  PRIMARY KEY (`user_id`),
  CONSTRAINT `game_preferences_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_proposals` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `head_id` int(10) unsigned NOT NULL,
  `spouse_id` int(10) unsigned NOT NULL,
  `from_id` int(10) unsigned NOT NULL,
  `status` enum('open','declined') NOT NULL DEFAULT 'open',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `answered_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `status` (`status`,`created_at`),
  KEY `head_id` (`head_id`),
  KEY `spouse_id` (`spouse_id`),
  KEY `from_id` (`from_id`),
  CONSTRAINT `game_proposals_ibfk_1` FOREIGN KEY (`head_id`) REFERENCES `game_anthros` (`id`) ON DELETE CASCADE,
  CONSTRAINT `game_proposals_ibfk_2` FOREIGN KEY (`spouse_id`) REFERENCES `game_anthros` (`id`) ON DELETE CASCADE,
  CONSTRAINT `game_proposals_ibfk_3` FOREIGN KEY (`from_id`) REFERENCES `game_anthros` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_ranks` (
  `rank` tinyint(3) unsigned NOT NULL,
  `name` varchar(40) NOT NULL,
  `female_name` varchar(40) NOT NULL,
  `is_noble` tinyint(1) NOT NULL DEFAULT 0,
  `is_hereditary` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`rank`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_recipe_goods` (
  `recipe_id` int(10) unsigned NOT NULL,
  `good` varchar(20) NOT NULL,
  `quantity` smallint(5) unsigned NOT NULL,
  `role` enum('in','out') NOT NULL,
  PRIMARY KEY (`recipe_id`,`role`,`good`),
  KEY `good` (`good`),
  CONSTRAINT `game_recipe_goods_ibfk_1` FOREIGN KEY (`recipe_id`) REFERENCES `game_recipes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `game_recipe_goods_ibfk_2` FOREIGN KEY (`good`) REFERENCES `game_market_goods` (`good`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_recipes` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `occupation_id` int(10) unsigned NOT NULL,
  `name` varchar(40) NOT NULL,
  `needs_acres` decimal(10,2) DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `occupation_id` (`occupation_id`),
  CONSTRAINT `game_recipes_ibfk_1` FOREIGN KEY (`occupation_id`) REFERENCES `game_occupations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=46 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_renames` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `anthro_id` int(10) unsigned NOT NULL,
  `old_name` varchar(64) NOT NULL,
  `new_name` varchar(64) NOT NULL,
  `renamed_at` datetime NOT NULL DEFAULT current_timestamp(),
  `renamed_by` int(10) unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `anthro_id` (`anthro_id`),
  KEY `renamed_by` (`renamed_by`),
  CONSTRAINT `game_renames_ibfk_1` FOREIGN KEY (`anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE CASCADE,
  CONSTRAINT `game_renames_ibfk_2` FOREIGN KEY (`renamed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_reset_requests` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `anthro_id` int(10) unsigned DEFAULT NULL,
  `reason` varchar(500) DEFAULT NULL,
  `status` enum('pending','done','dismissed') NOT NULL DEFAULT 'pending',
  `requested_at` datetime NOT NULL DEFAULT current_timestamp(),
  `handled_by` int(10) unsigned DEFAULT NULL,
  `handled_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `status` (`status`),
  KEY `user_id` (`user_id`),
  KEY `anthro_id` (`anthro_id`),
  KEY `handled_by` (`handled_by`),
  CONSTRAINT `game_reset_requests_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `game_reset_requests_ibfk_2` FOREIGN KEY (`anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_reset_requests_ibfk_3` FOREIGN KEY (`handled_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_saves` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `anthros` int(10) unsigned NOT NULL,
  `data` longblob NOT NULL,
  `created_by` int(10) unsigned DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `game_saves_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_schedule_days` (
  `anthro_id` int(10) unsigned NOT NULL,
  `day` date NOT NULL,
  `activity` enum('rest','breed','work','train','clear','build','forage') NOT NULL,
  `partner_anthro_id` int(10) unsigned DEFAULT NULL,
  `group_id` int(10) unsigned DEFAULT NULL,
  `skill_id` int(10) unsigned DEFAULT NULL,
  `occupation_id` int(10) unsigned DEFAULT NULL,
  `recipe_id` int(10) unsigned DEFAULT NULL,
  `part_id` int(10) unsigned DEFAULT NULL,
  `building_id` int(10) unsigned DEFAULT NULL,
  `set_by` int(10) unsigned DEFAULT NULL,
  PRIMARY KEY (`anthro_id`,`day`),
  KEY `partner_anthro_id` (`partner_anthro_id`),
  KEY `group_id` (`group_id`),
  KEY `skill_id` (`skill_id`),
  KEY `set_by` (`set_by`),
  KEY `occupation_id` (`occupation_id`),
  KEY `part_id` (`part_id`),
  KEY `building_id` (`building_id`),
  KEY `recipe_id` (`recipe_id`),
  CONSTRAINT `game_schedule_days_ibfk_1` FOREIGN KEY (`anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE CASCADE,
  CONSTRAINT `game_schedule_days_ibfk_2` FOREIGN KEY (`partner_anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_schedule_days_ibfk_3` FOREIGN KEY (`group_id`) REFERENCES `game_breeding_groups` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_schedule_days_ibfk_4` FOREIGN KEY (`skill_id`) REFERENCES `game_skills` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_schedule_days_ibfk_5` FOREIGN KEY (`set_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_schedule_days_ibfk_6` FOREIGN KEY (`occupation_id`) REFERENCES `game_occupations` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_schedule_days_ibfk_7` FOREIGN KEY (`part_id`) REFERENCES `game_barony_parts` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_schedule_days_ibfk_8` FOREIGN KEY (`building_id`) REFERENCES `game_buildings` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_schedule_days_ibfk_9` FOREIGN KEY (`recipe_id`) REFERENCES `game_recipes` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_schedule_log` (
  `anthro_id` int(10) unsigned NOT NULL,
  `day` date NOT NULL,
  `activity` enum('rest','breed','work','train','clear','build','forage','birthing') NOT NULL,
  `outcome` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`anthro_id`,`day`),
  CONSTRAINT `game_schedule_log_ibfk_1` FOREIGN KEY (`anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_schedule_weekly` (
  `anthro_id` int(10) unsigned NOT NULL,
  `weekday` tinyint(3) unsigned NOT NULL,
  `activity` enum('rest','breed','work','train','clear','build','forage') NOT NULL,
  `partner_anthro_id` int(10) unsigned DEFAULT NULL,
  `group_id` int(10) unsigned DEFAULT NULL,
  `skill_id` int(10) unsigned DEFAULT NULL,
  `occupation_id` int(10) unsigned DEFAULT NULL,
  `recipe_id` int(10) unsigned DEFAULT NULL,
  `part_id` int(10) unsigned DEFAULT NULL,
  `building_id` int(10) unsigned DEFAULT NULL,
  `set_by` int(10) unsigned DEFAULT NULL,
  PRIMARY KEY (`anthro_id`,`weekday`),
  KEY `partner_anthro_id` (`partner_anthro_id`),
  KEY `group_id` (`group_id`),
  KEY `skill_id` (`skill_id`),
  KEY `set_by` (`set_by`),
  KEY `occupation_id` (`occupation_id`),
  KEY `part_id` (`part_id`),
  KEY `building_id` (`building_id`),
  KEY `recipe_id` (`recipe_id`),
  CONSTRAINT `game_schedule_weekly_ibfk_1` FOREIGN KEY (`anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE CASCADE,
  CONSTRAINT `game_schedule_weekly_ibfk_2` FOREIGN KEY (`partner_anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_schedule_weekly_ibfk_3` FOREIGN KEY (`group_id`) REFERENCES `game_breeding_groups` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_schedule_weekly_ibfk_4` FOREIGN KEY (`skill_id`) REFERENCES `game_skills` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_schedule_weekly_ibfk_5` FOREIGN KEY (`set_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_schedule_weekly_ibfk_6` FOREIGN KEY (`occupation_id`) REFERENCES `game_occupations` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_schedule_weekly_ibfk_7` FOREIGN KEY (`part_id`) REFERENCES `game_barony_parts` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_schedule_weekly_ibfk_8` FOREIGN KEY (`building_id`) REFERENCES `game_buildings` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_schedule_weekly_ibfk_9` FOREIGN KEY (`recipe_id`) REFERENCES `game_recipes` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_settings` (
  `name` varchar(40) NOT NULL,
  `value` varchar(255) NOT NULL,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_skills` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(40) NOT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `era` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=35 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_species` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(64) NOT NULL,
  `group_id` int(10) unsigned NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`),
  KEY `group_id` (`group_id`),
  CONSTRAINT `game_species_ibfk_1` FOREIGN KEY (`group_id`) REFERENCES `game_species_groups` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=38 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_species_groups` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(64) NOT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_standard_days` (
  `schedule_id` int(10) unsigned NOT NULL,
  `weekday` tinyint(3) unsigned NOT NULL,
  `activity` enum('rest','breed','work','train','clear','build','forage') NOT NULL,
  `partner_anthro_id` int(10) unsigned DEFAULT NULL,
  `group_id` int(10) unsigned DEFAULT NULL,
  `skill_id` int(10) unsigned DEFAULT NULL,
  `occupation_id` int(10) unsigned DEFAULT NULL,
  `recipe_id` int(10) unsigned DEFAULT NULL,
  `part_id` int(10) unsigned DEFAULT NULL,
  `building_id` int(10) unsigned DEFAULT NULL,
  `set_by` int(10) unsigned DEFAULT NULL,
  PRIMARY KEY (`schedule_id`,`weekday`),
  KEY `partner_anthro_id` (`partner_anthro_id`),
  KEY `group_id` (`group_id`),
  KEY `skill_id` (`skill_id`),
  KEY `occupation_id` (`occupation_id`),
  KEY `part_id` (`part_id`),
  KEY `building_id` (`building_id`),
  KEY `set_by` (`set_by`),
  KEY `recipe_id` (`recipe_id`),
  CONSTRAINT `game_standard_days_ibfk_1` FOREIGN KEY (`schedule_id`) REFERENCES `game_standard_schedules` (`id`) ON DELETE CASCADE,
  CONSTRAINT `game_standard_days_ibfk_2` FOREIGN KEY (`partner_anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_standard_days_ibfk_3` FOREIGN KEY (`group_id`) REFERENCES `game_breeding_groups` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_standard_days_ibfk_4` FOREIGN KEY (`skill_id`) REFERENCES `game_skills` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_standard_days_ibfk_5` FOREIGN KEY (`occupation_id`) REFERENCES `game_occupations` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_standard_days_ibfk_6` FOREIGN KEY (`part_id`) REFERENCES `game_barony_parts` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_standard_days_ibfk_7` FOREIGN KEY (`building_id`) REFERENCES `game_buildings` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_standard_days_ibfk_8` FOREIGN KEY (`set_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_standard_days_ibfk_9` FOREIGN KEY (`recipe_id`) REFERENCES `game_recipes` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_standard_schedules` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `name` varchar(40) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`,`name`),
  CONSTRAINT `game_standard_schedules_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_transfers` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `anthro_id` int(10) unsigned NOT NULL,
  `from_owner_id` int(10) unsigned DEFAULT NULL,
  `to_owner_id` int(10) unsigned DEFAULT NULL,
  `transferred_at` datetime NOT NULL DEFAULT current_timestamp(),
  `transferred_by` int(10) unsigned DEFAULT NULL,
  `note` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `anthro_id` (`anthro_id`),
  KEY `transferred_by` (`transferred_by`),
  KEY `from_owner_id` (`from_owner_id`),
  KEY `to_owner_id` (`to_owner_id`),
  CONSTRAINT `game_transfers_ibfk_1` FOREIGN KEY (`anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE CASCADE,
  CONSTRAINT `game_transfers_ibfk_4` FOREIGN KEY (`transferred_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_transfers_ibfk_5` FOREIGN KEY (`from_owner_id`) REFERENCES `game_anthros` (`id`) ON DELETE SET NULL,
  CONSTRAINT `game_transfers_ibfk_6` FOREIGN KEY (`to_owner_id`) REFERENCES `game_anthros` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_wallets` (
  `anthro_id` int(10) unsigned NOT NULL,
  `balance` bigint(20) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`anthro_id`),
  CONSTRAINT `game_wallets_ibfk_1` FOREIGN KEY (`anthro_id`) REFERENCES `game_anthros` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `gurps_caster_rituals` (
  `character_id` int(10) unsigned NOT NULL,
  `ritual_id` int(10) unsigned NOT NULL,
  `added_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`character_id`,`ritual_id`),
  KEY `ritual_id` (`ritual_id`),
  CONSTRAINT `gurps_caster_rituals_ibfk_1` FOREIGN KEY (`character_id`) REFERENCES `gurps_characters` (`id`) ON DELETE CASCADE,
  CONSTRAINT `gurps_caster_rituals_ibfk_2` FOREIGN KEY (`ritual_id`) REFERENCES `gurps_rituals` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `gurps_castings` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `character_id` int(10) unsigned NOT NULL,
  `ritual_id` int(10) unsigned DEFAULT NULL,
  `ritual_name` varchar(80) NOT NULL,
  `kind` varchar(12) NOT NULL,
  `method` varchar(8) NOT NULL,
  `outcome` varchar(12) NOT NULL,
  `margin` int(11) DEFAULT NULL,
  `energy` int(10) unsigned NOT NULL,
  `quirks` smallint(5) unsigned NOT NULL DEFAULT 0,
  `creation_id` int(10) unsigned DEFAULT NULL,
  `detail` mediumtext NOT NULL,
  `notes` text NOT NULL DEFAULT '',
  `cast_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `character_id` (`character_id`,`cast_at`),
  KEY `ritual_id` (`ritual_id`),
  KEY `creation_id` (`creation_id`),
  CONSTRAINT `gurps_castings_ibfk_1` FOREIGN KEY (`character_id`) REFERENCES `gurps_characters` (`id`) ON DELETE CASCADE,
  CONSTRAINT `gurps_castings_ibfk_2` FOREIGN KEY (`ritual_id`) REFERENCES `gurps_rituals` (`id`) ON DELETE SET NULL,
  CONSTRAINT `gurps_castings_ibfk_3` FOREIGN KEY (`creation_id`) REFERENCES `gurps_creations` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `gurps_characters` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `gcs_id` varchar(64) DEFAULT NULL,
  `name` varchar(100) NOT NULL,
  `summary` text NOT NULL,
  `data` mediumtext NOT NULL,
  `imported_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`,`gcs_id`),
  CONSTRAINT `gurps_characters_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `gurps_creations` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `character_id` int(10) unsigned NOT NULL,
  `ritual_id` int(10) unsigned DEFAULT NULL,
  `kind` varchar(12) NOT NULL,
  `name` varchar(80) NOT NULL,
  `description` varchar(255) NOT NULL DEFAULT '',
  `effects` text DEFAULT NULL,
  `energy` int(10) unsigned NOT NULL,
  `margin` int(11) NOT NULL,
  `quirks` smallint(5) unsigned DEFAULT NULL,
  `quirk_notes` text NOT NULL DEFAULT '',
  `trigger` varchar(200) NOT NULL DEFAULT '',
  `form` varchar(12) DEFAULT NULL,
  `details` text NOT NULL DEFAULT '',
  `made_at` datetime NOT NULL DEFAULT current_timestamp(),
  `used_at` datetime DEFAULT NULL,
  `target` varchar(80) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `character_id` (`character_id`,`made_at`),
  KEY `ritual_id` (`ritual_id`),
  CONSTRAINT `gurps_creations_ibfk_1` FOREIGN KEY (`character_id`) REFERENCES `gurps_characters` (`id`) ON DELETE CASCADE,
  CONSTRAINT `gurps_creations_ibfk_2` FOREIGN KEY (`ritual_id`) REFERENCES `gurps_rituals` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `gurps_grimoire_rituals` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `grimoire_id` int(10) unsigned NOT NULL,
  `ritual_id` int(10) unsigned DEFAULT NULL,
  `name` varchar(80) NOT NULL,
  `bonus` tinyint(3) unsigned NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `grimoire_id` (`grimoire_id`,`ritual_id`),
  KEY `ritual_id` (`ritual_id`),
  CONSTRAINT `gurps_grimoire_rituals_ibfk_1` FOREIGN KEY (`grimoire_id`) REFERENCES `gurps_grimoires` (`id`) ON DELETE CASCADE,
  CONSTRAINT `gurps_grimoire_rituals_ibfk_2` FOREIGN KEY (`ritual_id`) REFERENCES `gurps_rituals` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `gurps_grimoires` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `character_id` int(10) unsigned NOT NULL,
  `name` varchar(80) NOT NULL,
  `kind` varchar(12) NOT NULL DEFAULT 'grimoire',
  `comprehension` varchar(12) NOT NULL DEFAULT 'native',
  `own` tinyint(1) NOT NULL DEFAULT 0,
  `description` text NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `character_id` (`character_id`,`name`),
  CONSTRAINT `gurps_grimoires_ibfk_1` FOREIGN KEY (`character_id`) REFERENCES `gurps_characters` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `gurps_rituals` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `name` varchar(80) NOT NULL,
  `notes` text NOT NULL,
  `effects` text NOT NULL,
  `modifiers` text NOT NULL,
  `trappings` tinyint(3) unsigned NOT NULL DEFAULT 0,
  `elixir` tinyint(1) NOT NULL DEFAULT 0,
  `energy` int(10) unsigned NOT NULL,
  `shared` tinyint(1) NOT NULL DEFAULT 0,
  `public_domain` tinyint(1) NOT NULL DEFAULT 0,
  `book` varchar(120) DEFAULT NULL,
  `book_page` smallint(5) unsigned DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`,`name`),
  KEY `shared` (`shared`),
  CONSTRAINT `gurps_rituals_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `gurps_settings` (
  `name` varchar(32) NOT NULL,
  `value` varchar(255) NOT NULL,
  `updated_by` int(10) unsigned DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`name`),
  KEY `updated_by` (`updated_by`),
  CONSTRAINT `gurps_settings_ibfk_1` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `gurps_target_effects` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `target_id` int(10) unsigned NOT NULL,
  `character_id` int(10) unsigned DEFAULT NULL,
  `casting_id` int(10) unsigned DEFAULT NULL,
  `creation_id` int(10) unsigned DEFAULT NULL,
  `ritual_name` varchar(80) NOT NULL,
  `kind` varchar(12) NOT NULL,
  `effects` text NOT NULL,
  `cast_at` datetime NOT NULL DEFAULT current_timestamp(),
  `expired_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `target_id` (`target_id`,`expired_at`),
  KEY `character_id` (`character_id`),
  KEY `casting_id` (`casting_id`),
  KEY `creation_id` (`creation_id`),
  CONSTRAINT `gurps_target_effects_ibfk_1` FOREIGN KEY (`target_id`) REFERENCES `gurps_targets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `gurps_target_effects_ibfk_2` FOREIGN KEY (`character_id`) REFERENCES `gurps_characters` (`id`) ON DELETE SET NULL,
  CONSTRAINT `gurps_target_effects_ibfk_3` FOREIGN KEY (`casting_id`) REFERENCES `gurps_castings` (`id`) ON DELETE SET NULL,
  CONSTRAINT `gurps_target_effects_ibfk_4` FOREIGN KEY (`creation_id`) REFERENCES `gurps_creations` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `gurps_targets` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(80) NOT NULL,
  `created_by` int(10) unsigned DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `gurps_targets_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `login_history` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `ip` varchar(45) NOT NULL,
  `logged_in_at` datetime NOT NULL DEFAULT current_timestamp(),
  `last_seen_at` datetime NOT NULL DEFAULT current_timestamp(),
  `logged_out_at` datetime DEFAULT NULL,
  `logout_reason` varchar(32) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`,`logged_in_at`),
  CONSTRAINT `login_history_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `pages` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `path` varchar(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `markdown` mediumtext NOT NULL,
  `created_by` int(10) unsigned DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL,
  `updated_by` int(10) unsigned DEFAULT NULL,
  `version` int(10) unsigned NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `path` (`path`),
  KEY `created_by` (`created_by`),
  KEY `updated_by` (`updated_by`),
  CONSTRAINT `pages_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `pages_ibfk_2` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `password_changes` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `changed_at` datetime NOT NULL DEFAULT current_timestamp(),
  `ip` varchar(45) NOT NULL,
  `changed_by` int(10) unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`,`changed_at`),
  KEY `changed_by` (`changed_by`),
  CONSTRAINT `password_changes_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `password_changes_ibfk_2` FOREIGN KEY (`changed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `roles` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(32) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `color` varchar(16) NOT NULL DEFAULT 'primary',
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `site_settings` (
  `name` varchar(40) NOT NULL,
  `value` text DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `updated_by` int(10) unsigned DEFAULT NULL,
  PRIMARY KEY (`name`),
  KEY `updated_by` (`updated_by`),
  CONSTRAINT `site_settings_ibfk_1` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_roles` (
  `user_id` int(10) unsigned NOT NULL,
  `role_id` int(10) unsigned NOT NULL,
  PRIMARY KEY (`user_id`,`role_id`),
  KEY `role_id` (`role_id`),
  CONSTRAINT `user_roles_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `user_roles_ibfk_2` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `username` varchar(32) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `last_login_at` datetime DEFAULT NULL,
  `session_version` int(10) unsigned NOT NULL DEFAULT 0,
  `expires_at` datetime DEFAULT NULL,
  `password_changed_at` datetime NOT NULL DEFAULT current_timestamp(),
  `validated_at` datetime DEFAULT NULL,
  `allowed_ips` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
