// Upstream: game/src/Names.php
import { Auth } from '../core/Auth';
import type { Db, Row } from '../db/Db';
import { array_fill, array_unique, int, mb_strlen, trim } from '../core/php';

/**
 * Random anthro names, kept in game_names so admins can manage them. is_male and is_female say which gender
 * presentations a name can go to: male-presenting anthros get names marked is_male, female-presenting ones names
 * marked is_female, and androgynous ones (or an unknown gender) neutral names, marked both. A name marked neither is
 * never picked.
 */
export class Names {
    static readonly MAX_NAME = 64;

    // The starting names, inserted only when game_names is first created.
    private static readonly SEED_MALE = [
        'Aldric', 'Ansel', 'Axel', 'Barnaby', 'Basil', 'Bram', 'Caspian', 'Corwin', 'Cyrus', 'Dex',
        'Dorian', 'Edric', 'Emrys', 'Felix', 'Fenn', 'Flint', 'Gideon', 'Gunnar', 'Heath', 'Hugo',
        'Jasper', 'Jonah', 'Leo', 'Lucan', 'Magnus', 'Milo', 'Orion', 'Otto', 'Pike', 'Rhys',
        'Ridley', 'Rook', 'Rufus', 'Silas', 'Theo', 'Thorne', 'Tobin', 'Tristan', 'Abel', 'Alaric',
        'Albin', 'Alden', 'Alistair', 'Ambrose', 'Anders', 'Arlo', 'Arvid', 'Atticus', 'August', 'Balthazar',
        'Barrett', 'Beckett', 'Benedict', 'Bertram', 'Bjorn', 'Boris', 'Brandt', 'Brock', 'Bruno', 'Caddock',
        'Cadmus', 'Caleb', 'Callum', 'Casimir', 'Cedric', 'Cillian', 'Clement', 'Conrad', 'Cormac', 'Crispin',
        'Dagfinn', 'Damon', 'Darius', 'Declan', 'Desmond', 'Dietrich', 'Duncan', 'Eamon', 'Edgar', 'Edmund',
        'Eero', 'Egon', 'Einar', 'Elias', 'Emeric', 'Enzo', 'Erasmus', 'Ernst', 'Evander', 'Ewan',
        'Fabian', 'Falk', 'Fergus', 'Finnian', 'Florian', 'Fritz', 'Gareth', 'Garrick', 'Gaspard', 'Gerard',
        'Godric', 'Gregor', 'Griffin', 'Gustav', 'Hadrian', 'Halvard', 'Hamish', 'Harald', 'Hector', 'Henrik',
        'Horace', 'Ignatius', 'Igor', 'Isak', 'Ivor', 'Jarvis', 'Joachim', 'Jorah', 'Julian', 'Kasimir',
        'Keir', 'Kellan', 'Kenrick', 'Klaus', 'Konrad', 'Lachlan', 'Lambert', 'Leander', 'Leif', 'Lennox',
        'Leopold', 'Lorcan', 'Lucius', 'Ludwig', 'Malcolm', 'Marius', 'Matthias', 'Maximilian', 'Merrick', 'Mortimer',
        'Murdoch', 'Nestor', 'Nikolai', 'Njord', 'Octavian', 'Odin', 'Olaf', 'Oskar', 'Osric', 'Oswin',
        'Pascal', 'Percival', 'Phineas', 'Quentin', 'Radek', 'Ragnar', 'Randolph', 'Reinhold', 'Roderick', 'Roland',
        'Rolf', 'Rupert', 'Sebastian', 'Severin', 'Sigmund', 'Soren', 'Stellan', 'Sven', 'Tadeo', 'Tarquin',
        'Thaddeus', 'Thorvald', 'Tiberius', 'Torsten', 'Ulric', 'Valen', 'Viktor', 'Wolfram', 'Alfie', 'Anton',
        'Benno', 'Cato', 'Dmitri', 'Eben', 'Garth', 'Hansel', 'Ivo', 'Lukas', 'Aurelio', 'Bastian',
        'Corbin', 'Dario', 'Emil', 'Fyodor', 'Gideonne', 'Jorik', 'Kaspar', 'Linus', 'Mathis', 'Nils',
    ];

    private static readonly SEED_FEMALE = [
        'Amber', 'Aria', 'Aurora', 'Celeste', 'Clover', 'Dahlia', 'Delia', 'Elodie', 'Esme', 'Fiona',
        'Freya', 'Greta', 'Hazel', 'Holly', 'Ingrid', 'Iris', 'Isla', 'Ivy', 'Juniper', 'Juno',
        'Luna', 'Lyra', 'Mabel', 'Maple', 'Nell', 'Opal', 'Poppy', 'Rosalind', 'Saffron', 'Stella',
        'Tamsin', 'Thea', 'Una', 'Violet', 'Willow', 'Zinnia', 'Ada', 'Adela', 'Adelaide', 'Agatha',
        'Alba', 'Alma', 'Althea', 'Amara', 'Anneliese', 'Annika', 'Arabella', 'Astrid', 'Beatrix', 'Belle',
        'Bianca', 'Blythe', 'Brigid', 'Brunhilde', 'Calla', 'Camilla', 'Carmen', 'Cassia', 'Cecily', 'Clara',
        'Clementine', 'Colette', 'Cora', 'Cordelia', 'Daphne', 'Delphine', 'Dora', 'Dorothea', 'Edith', 'Eira',
        'Eleanor', 'Elena', 'Eliza', 'Elsa', 'Elspeth', 'Emmeline', 'Estelle', 'Eudora', 'Evangeline', 'Flora',
        'Florence', 'Frida', 'Gemma', 'Genevieve', 'Georgina', 'Gisela', 'Greer', 'Gwendolyn', 'Hattie', 'Hedda',
        'Helena', 'Henrietta', 'Hilda', 'Honora', 'Ida', 'Imogen', 'Inga', 'Irena', 'Isadora', 'Isolde',
        'Jessamine', 'Josephine', 'Juliet', 'Karin', 'Katrin', 'Keira', 'Kirsten', 'Lavinia', 'Leonie', 'Liesel',
        'Lilith', 'Liv', 'Lorelei', 'Lucia', 'Lucinda', 'Lydia', 'Magdalena', 'Maisie', 'Margot', 'Marguerite',
        'Marigold', 'Marisol', 'Matilda', 'Maude', 'Meredith', 'Mina', 'Minerva', 'Miriam', 'Nadia', 'Natasha',
        'Nerys', 'Nina', 'Octavia', 'Odette', 'Olga', 'Olive', 'Ophelia', 'Orla', 'Petra', 'Philippa',
        'Primrose', 'Prudence', 'Ramona', 'Rhiannon', 'Rosa', 'Rosamund', 'Rosemary', 'Ruby', 'Sabine', 'Selene',
        'Seraphina', 'Sigrid', 'Silvia', 'Solveig', 'Sophia', 'Svea', 'Sybil', 'Talia', 'Tatiana', 'Tilda',
        'Ursula', 'Valentina', 'Vera', 'Veronica', 'Vivienne', 'Wilhelmina', 'Winifred', 'Xenia', 'Yvette', 'Zelda',
        'Zora', 'Anya', 'Bettina', 'Dagny', 'Elke', 'Aveline', 'Blanche', 'Cressida', 'Elowen', 'Faye',
        'Hester', 'Linnea', 'Mireille', 'Noor', 'Pia', 'Saskia', 'Tove', 'Adeline', 'Briony', 'Celandine',
        'Dulcie', 'Eveline', 'Honoria', 'Isobel', 'Jolene', 'Katja', 'Laurentia', 'Lenore', 'Mirabel', 'Nerissa',
    ];

    private static readonly SEED_NEUTRAL = [
        'Ash', 'Aspen', 'Birch', 'Bramble', 'Briar', 'Bryn', 'Cedar', 'Cinder', 'Dash', 'Dusk',
        'Echo', 'Elm', 'Ember', 'Fable', 'Fern', 'Finch', 'Gale', 'Garnet', 'Hollis', 'Indigo',
        'Kai', 'Kestrel', 'Kit', 'Lark', 'Linden', 'Lumen', 'Marlow', 'Mica', 'Moss', 'Nettle',
        'Nova', 'Nyx', 'Oakley', 'Onyx', 'Pax', 'Pepper', 'Pip', 'Quill', 'Raven', 'Reed',
        'Remy', 'Rowan', 'Rue', 'Sable', 'Sage', 'Shale', 'Skye', 'Slate', 'Sorrel', 'Sparrow',
        'Storm', 'Sunny', 'Tansy', 'Teal', 'Thistle', 'Umber', 'Vale', 'Vesper', 'Wisp', 'Wren',
        'Yarrow', 'Zephyr', 'Acorn', 'Alder', 'Arbor', 'Ari', 'Arrow', 'Auburn', 'Avery', 'Basalt',
        'Bay', 'Beck', 'Blaze', 'Blue', 'Bracken', 'Brook', 'Burr', 'Cairn', 'Cairo', 'Clay',
        'Cobalt', 'Coda', 'Comet', 'Copper', 'Coral', 'Cove', 'Crane', 'Cricket', 'Crow', 'Dale',
        'Dune', 'Eider', 'Ellis', 'Emery', 'Fallow', 'Fir', 'Flicker', 'Flurry', 'Fox', 'Frost',
        'Gray', 'Grove', 'Haven', 'Hawthorn', 'Heron', 'Hickory', 'Hollow', 'Ivory', 'Jade', 'Jay',
        'Jet', 'Juni', 'Kenzie', 'Kiran', 'Lake', 'Larch', 'Laurel', 'Lichen', 'Loam', 'Lochlan',
        'Lynx', 'Mallow', 'Marsh', 'Meadow', 'Merit', 'Mist', 'Morrow', 'Nimbus', 'North', 'Oak',
        'Ocean', 'Olin', 'Pebble', 'Perrin', 'Phoenix', 'Pine', 'Plover', 'Quarry', 'Quinn', 'Rain',
        'Ramsey', 'Rill', 'Ripple', 'River', 'Robin', 'Rune', 'Rush', 'Russet', 'Rye', 'Salem',
        'Sequoia', 'Shadow', 'Shiloh', 'Sierra', 'Sky', 'Smoke', 'Sol', 'Sparrowhawk', 'Spruce', 'Stone',
        'Summit', 'Tamarack', 'Tarn', 'Tempest', 'Thorn', 'Timber', 'Topaz', 'Tor', 'Trace', 'Tully',
        'Twig', 'Vireo', 'Wilder', 'Winter', 'Wolfe', 'Yew', 'Zen', 'Harbor', 'Jubilee', 'Loch',
        'Marin', 'Nico', 'Oriel', 'Quincy', 'Rafferty', 'Sasha', 'Tobi', 'Vail', 'Wynn', 'Aeris',
        'Bexley', 'Cadence', 'Darby', 'Ellery', 'Frankie', 'Hayden', 'Sorrelle', 'Kieran', 'Lior', 'Morgan',
    ];

    /**
     * A random name for the presentation ('male', 'female', or anything else for neutral) that the owner's anthros
     * don't have yet (ownerId 0: free anthros and the game's). Once every suitable name is used, names can repeat.
     */
    static random(ownerId: number, presentsAs: string | null): string {
        let where: string;
        switch (presentsAs) {
            case 'male': where = 'n.is_male'; break;
            case 'female': where = 'n.is_female'; break;
            default: where = 'n.is_male AND n.is_female';
        }
        // 0: anthros nobody else owns (free ones and the game's).
        const owner = ownerId ? 'a.owner_id = ?' : '(a.owner_id IS NULL OR a.owner_id = a.id)';
        const params = ownerId ? [ownerId] : [];
        const db = Auth.db();
        let name: string | null = db.value(
            `SELECT n.name FROM game_names n
             WHERE ${where} AND NOT EXISTS (SELECT 1 FROM game_anthros a WHERE a.name = n.name AND ${owner})
             ORDER BY RAND() LIMIT 1`,
            params,
        );
        if (name === null) {
            name = db.value(`SELECT n.name FROM game_names n WHERE ${where} ORDER BY RAND() LIMIT 1`);
        }
        return name === null ? 'Nameless' : name;
    }

    /**
     * Every name, alphabetically.
     */
    static all(): Row[] {
        return Auth.db().all('SELECT * FROM game_names ORDER BY name').map(Names.withFlags);
    }

    /**
     * How many names each presentation can draw on: { male: n, female: n, neutral: n, unused: n }.
     */
    static counts(): { male: number; female: number; neutral: number; unused: number } {
        const row = Auth.db().row(
            `SELECT SUM(is_male AND NOT is_female) AS male, SUM(is_female AND NOT is_male) AS female,
                    SUM(is_male AND is_female) AS neutral, SUM(NOT is_male AND NOT is_female) AS unused
             FROM game_names`,
        )!;
        return { male: int(row.male), female: int(row.female), neutral: int(row.neutral), unused: int(row.unused) };
    }

    /**
     * Adds names, one per line (or comma-separated), all with the same flags; ones already listed are skipped.
     * Returns [how many were added, null] or [null, error message].
     */
    static add(names: string, isMale: boolean, isFemale: boolean): [number | null, string | null] {
        const list = array_unique(names.split(/[\r\n,]+/).map((n) => trim(n)).filter((n) => n.length > 0));
        if (!list.length) {
            return [null, 'Enter at least one name.'];
        }
        for (const name of list) {
            const error = Names.validate(name);
            if (error) {
                return [null, error];
            }
        }
        const insert = 'INSERT OR IGNORE INTO game_names (name, is_male, is_female) VALUES (?, ?, ?)';
        let added = 0;
        for (const name of list) {
            added += Auth.db().run(insert, [name, int(isMale), int(isFemale)]);
        }
        return [added, null];
    }

    /**
     * Renames a name and sets its flags. Returns an error message, or null.
     */
    static update(id: number, name: string, isMale: boolean, isFemale: boolean): string | null {
        name = trim(name);
        const error = Names.validate(name);
        if (error) {
            return error;
        }
        if (Auth.db().value('SELECT id FROM game_names WHERE name = ? AND id <> ?', [name, id])) {
            return `${name} is already in the list.`;
        }
        Auth.db().run('UPDATE game_names SET name = ?, is_male = ?, is_female = ? WHERE id = ?', [name, int(isMale), int(isFemale), id]);
        return null;
    }

    /**
     * Removes names from the list (anthros already named keep their names). Returns how many were removed.
     */
    static delete(ids: unknown[]): number {
        const list = array_unique(ids.map(int));
        if (!list.length) {
            return 0;
        }
        return Auth.db().run('DELETE FROM game_names WHERE id IN (' + array_fill(list.length, '?').join(', ') + ')', list);
    }

    /**
     * Fills an empty game_names with the starting names (from Schema::migrate, with the DBA connection).
     */
    static seed(db: Db): void {
        const insert = 'INSERT OR IGNORE INTO game_names (name, is_male, is_female) VALUES (?, ?, ?)';
        for (const [names, isMale, isFemale] of [[Names.SEED_MALE, 1, 0], [Names.SEED_FEMALE, 0, 1], [Names.SEED_NEUTRAL, 1, 1]] as const) {
            for (const name of names) {
                db.run(insert, [name, isMale, isFemale]);
            }
        }
    }

    private static validate(name: string): string | null {
        if (name === '' || mb_strlen(name) > Names.MAX_NAME) {
            return 'Names must be 1-' + Names.MAX_NAME + ' characters.';
        }
        return null;
    }

    private static withFlags(row: Row): Row {
        row.is_male = !!row.is_male;
        row.is_female = !!row.is_female;
        return row;
    }
}
