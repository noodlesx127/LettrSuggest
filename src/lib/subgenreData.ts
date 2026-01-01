/**
 * Sub-genre definitions with display names and TMDB keyword IDs
 * Used for both UI selection and TMDB keyword-based discovery
 */

// Map subgenre key to TMDB keyword IDs (reverse of tmdbKeywordIds.ts)
export const SUBGENRE_TO_KEYWORD_IDS: Record<string, number[]> = {
    // HORROR
    HORROR_SUPERNATURAL: [6152],
    HORROR_PSYCHOLOGICAL: [295907],
    HORROR_SLASHER: [12339],
    HORROR_ZOMBIE: [12377],
    HORROR_BODY: [283085],
    HORROR_FOLK: [209568],
    HORROR_WITCH: [616],
    HORROR_COSMIC: [215959],
    HORROR_OCCULT: [156174],
    HORROR_GOTHIC: [15032],
    HORROR_FOUND_FOOTAGE: [163053],
    HORROR_MONSTER: [1299],
    HORROR_VAMPIRE: [3133],
    HORROR_WEREWOLF: [12564],
    HORROR_RELIGIOUS: [239680],
    HORROR_COMEDY: [362402],
    HORROR_ECO: [237516],
    HORROR_TECH: [306144],
    HORROR_HOLIDAY: [323756],
    HORROR_PERIOD: [343511],
    HORROR_EXTREME: [345799],
    HORROR_ELEVATED: [353788],
    HORROR_REVENGE: [288882],
    HORROR_GIALLO: [361094],
    HORROR_SCIFI: [323910],
    HORROR_ANALOG: [319324],

    // THRILLER
    THRILLER_PSYCHOLOGICAL: [12565],
    THRILLER_CONSPIRACY: [10410],
    THRILLER_CRIME: [355372],
    THRILLER_NEO_NOIR: [207268],
    THRILLER_LEGAL: [254459],
    THRILLER_POLITICAL: [209817],
    THRILLER_EROTIC: [207767],
    THRILLER_SPY: [217282],
    THRILLER_MEDICAL: [289673],
    THRILLER_TECH: [298605],
    THRILLER_REVENGE: [252204],
    THRILLER_ACTION: [302132],

    // DRAMA
    DRAMA_PSYCHOLOGICAL: [309029],
    DRAMA_SURREAL: [3307],
    DRAMA_ARTHOUSE: [318182],
    DRAMA_SLOW_BURN: [277551],
    DRAMA_HISTORICAL: [15126],
    DRAMA_FAMILY: [12279],
    DRAMA_COMING_OF_AGE: [10683],
    DRAMA_ROMANTIC: [304976],
    DRAMA_SOCIAL: [306007],
    DRAMA_COURTROOM: [214780],
    DRAMA_MEDICAL: [208788],
    DRAMA_SPORTS: [294708],
    DRAMA_WAR: [324284],
    DRAMA_POLITICAL: [298528],
    DRAMA_BIOGRAPHICAL: [5565],
    DRAMA_TRAGEDY: [10614],
    DRAMA_MELODRAMA: [293016],
    DRAMA_MUSICAL: [339962],
    DRAMA_EXISTENTIAL: [295182],
    DRAMA_RELIGIOUS: [298552],
    DRAMA_PRISON: [355148],

    // SCI-FI
    SCIFI_SPACE: [9882],
    SCIFI_CYBERPUNK: [12190],
    SCIFI_TIME_TRAVEL: [4379],
    SCIFI_ALIEN: [9951],
    SCIFI_POST_APOCALYPTIC: [359337],
    SCIFI_DYSTOPIA: [4565],
    SCIFI_UTOPIA: [3469],
    SCIFI_SPACE_OPERA: [161176],
    SCIFI_BIOPUNK: [240875],
    SCIFI_STEAMPUNK: [10028],
    SCIFI_ROBOT: [14544],
    SCIFI_VIRTUAL_REALITY: [4563],
    SCIFI_KAIJU: [161791],
    SCIFI_MILITARY: [298591],
    SCIFI_INVASION: [14909],
    SCIFI_TECH_NOIR: [178657],
    SCIFI_CLONE: [402],

    // COMEDY
    COMEDY_ROMANTIC: [363715],
    COMEDY_DARK: [10123],
    COMEDY_SATIRE: [8201],
    COMEDY_PARODY: [9755],
    COMEDY_SLAPSTICK: [9253],
    COMEDY_BUDDY: [167541],
    COMEDY_SCREWBALL: [155457],
    COMEDY_STONER: [302399],
    COMEDY_ABSURD: [309974],
    COMEDY_CRINGE: [363145],
    COMEDY_DRAMEDY: [203322],
    COMEDY_ACTION: [247799],
    COMEDY_TEEN: [155722],
    COMEDY_IMPROV: [215711],

    // ACTION
    ACTION_SUPERHERO: [9715],
    ACTION_SPY: [470],
    ACTION_MILITARY: [162365],
    ACTION_MARTIAL_ARTS: [779],
    ACTION_HEIST: [10051],
    ACTION_CAR_CHASE: [357378],
    ACTION_DISASTER: [10617],
    ACTION_BUDDY_COP: [167316],
    ACTION_REVENGE: [9748],
    ACTION_MERCENARY: [3070],
    ACTION_SWASHBUCKLER: [157186],
    ACTION_WESTERN: [305941],
    ACTION_GUNPLAY: [209242],
    ACTION_PARKOUR: [6955],

    // ANIMATION
    ANIME_SCIFI: [210024],
    ANIME_MECHA: [10046],
    ANIME_SHONEN: [363152],
    ANIME_SEINEN: [195668],
    ANIME_SLICE_OF_LIFE: [9914],
    ANIME_ISEKAI: [237451],
    ANIMATION_PIXAR: [338822],
    ANIMATION_STOP_MOTION: [10121],
    ANIMATION_ADULT: [161919],

    // DOCUMENTARY
    DOC_TRUE_CRIME: [33722],
    DOC_NATURE: [221355],
    DOC_MUSIC: [246377],
    DOC_SPORTS: [159290],
    DOC_POLITICAL: [239902],
    DOC_FOOD: [307690],
    DOC_TRAVEL: [310315],
    DOC_HISTORICAL: [321490],

    // ROMANCE
    ROMANCE_PERIOD: [361772],
    ROMANCE_TRAGIC: [186956],
    ROMANCE_INTERRACIAL: [10194],

    // FANTASY
    FANTASY_EPIC: [335572],
    FANTASY_DARK: [177895],
    FANTASY_URBAN: [298549],
    FANTASY_FAIRY_TALE: [3205],
    FANTASY_SWORD_SORCERY: [234213],
    FANTASY_MYTHOLOGICAL: [207003],
};

// Subgenre display info with parent genre mapping
export interface SubgenreInfo {
    key: string;
    name: string;
    emoji: string;
    parentGenreId: number;
    keywordIds: number[];
}

// Map parent genre IDs to their subgenres
export const SUBGENRES_BY_PARENT: Record<number, SubgenreInfo[]> = {
    // Horror (27)
    27: [
        { key: 'HORROR_SUPERNATURAL', name: 'Supernatural', emoji: '👻', parentGenreId: 27, keywordIds: [6152] },
        { key: 'HORROR_PSYCHOLOGICAL', name: 'Psychological', emoji: '🧠', parentGenreId: 27, keywordIds: [295907] },
        { key: 'HORROR_SLASHER', name: 'Slasher', emoji: '🔪', parentGenreId: 27, keywordIds: [12339] },
        { key: 'HORROR_ZOMBIE', name: 'Zombie', emoji: '🧟', parentGenreId: 27, keywordIds: [12377] },
        { key: 'HORROR_BODY', name: 'Body Horror', emoji: '🦠', parentGenreId: 27, keywordIds: [283085] },
        { key: 'HORROR_FOLK', name: 'Folk Horror', emoji: '🌾', parentGenreId: 27, keywordIds: [209568] },
        { key: 'HORROR_COSMIC', name: 'Cosmic/Lovecraft', emoji: '🌌', parentGenreId: 27, keywordIds: [215959] },
        { key: 'HORROR_GOTHIC', name: 'Gothic', emoji: '🏰', parentGenreId: 27, keywordIds: [15032] },
        { key: 'HORROR_FOUND_FOOTAGE', name: 'Found Footage', emoji: '📹', parentGenreId: 27, keywordIds: [163053] },
        { key: 'HORROR_VAMPIRE', name: 'Vampire', emoji: '🧛', parentGenreId: 27, keywordIds: [3133] },
        { key: 'HORROR_WEREWOLF', name: 'Werewolf', emoji: '🐺', parentGenreId: 27, keywordIds: [12564] },
        { key: 'HORROR_COMEDY', name: 'Horror Comedy', emoji: '😱😂', parentGenreId: 27, keywordIds: [362402] },
        { key: 'HORROR_ELEVATED', name: 'Elevated/A24', emoji: '🎭', parentGenreId: 27, keywordIds: [353788] },
    ],

    // Thriller (53)
    53: [
        { key: 'THRILLER_PSYCHOLOGICAL', name: 'Psychological', emoji: '🧠', parentGenreId: 53, keywordIds: [12565] },
        { key: 'THRILLER_CONSPIRACY', name: 'Conspiracy', emoji: '🕵️', parentGenreId: 53, keywordIds: [10410] },
        { key: 'THRILLER_CRIME', name: 'Crime', emoji: '🚔', parentGenreId: 53, keywordIds: [355372] },
        { key: 'THRILLER_NEO_NOIR', name: 'Neo-Noir', emoji: '🌃', parentGenreId: 53, keywordIds: [207268] },
        { key: 'THRILLER_LEGAL', name: 'Legal', emoji: '⚖️', parentGenreId: 53, keywordIds: [254459] },
        { key: 'THRILLER_POLITICAL', name: 'Political', emoji: '🏛️', parentGenreId: 53, keywordIds: [209817] },
        { key: 'THRILLER_SPY', name: 'Spy/Espionage', emoji: '🕶️', parentGenreId: 53, keywordIds: [217282] },
        { key: 'THRILLER_REVENGE', name: 'Revenge', emoji: '💢', parentGenreId: 53, keywordIds: [252204] },
        { key: 'THRILLER_ACTION', name: 'Action Thriller', emoji: '💥', parentGenreId: 53, keywordIds: [302132] },
    ],

    // Science Fiction (878)
    878: [
        { key: 'SCIFI_SPACE', name: 'Space', emoji: '🚀', parentGenreId: 878, keywordIds: [9882] },
        { key: 'SCIFI_CYBERPUNK', name: 'Cyberpunk', emoji: '🤖', parentGenreId: 878, keywordIds: [12190] },
        { key: 'SCIFI_TIME_TRAVEL', name: 'Time Travel', emoji: '⏰', parentGenreId: 878, keywordIds: [4379] },
        { key: 'SCIFI_ALIEN', name: 'Alien', emoji: '👽', parentGenreId: 878, keywordIds: [9951] },
        { key: 'SCIFI_POST_APOCALYPTIC', name: 'Post-Apocalyptic', emoji: '☢️', parentGenreId: 878, keywordIds: [359337] },
        { key: 'SCIFI_DYSTOPIA', name: 'Dystopia', emoji: '🏚️', parentGenreId: 878, keywordIds: [4565] },
        { key: 'SCIFI_SPACE_OPERA', name: 'Space Opera', emoji: '⭐', parentGenreId: 878, keywordIds: [161176] },
        { key: 'SCIFI_ROBOT', name: 'Robot/AI', emoji: '🤖', parentGenreId: 878, keywordIds: [14544] },
        { key: 'SCIFI_VIRTUAL_REALITY', name: 'Virtual Reality', emoji: '🥽', parentGenreId: 878, keywordIds: [4563] },
    ],

    // Comedy (35)
    35: [
        { key: 'COMEDY_ROMANTIC', name: 'Romantic Comedy', emoji: '💕', parentGenreId: 35, keywordIds: [363715] },
        { key: 'COMEDY_DARK', name: 'Dark Comedy', emoji: '🖤', parentGenreId: 35, keywordIds: [10123] },
        { key: 'COMEDY_SATIRE', name: 'Satire', emoji: '🎭', parentGenreId: 35, keywordIds: [8201] },
        { key: 'COMEDY_PARODY', name: 'Parody/Spoof', emoji: '🤪', parentGenreId: 35, keywordIds: [9755] },
        { key: 'COMEDY_SLAPSTICK', name: 'Slapstick', emoji: '🤡', parentGenreId: 35, keywordIds: [9253] },
        { key: 'COMEDY_BUDDY', name: 'Buddy Comedy', emoji: '👯', parentGenreId: 35, keywordIds: [167541] },
        { key: 'COMEDY_TEEN', name: 'Teen Comedy', emoji: '🎒', parentGenreId: 35, keywordIds: [155722] },
        { key: 'COMEDY_ACTION', name: 'Action Comedy', emoji: '💥😂', parentGenreId: 35, keywordIds: [247799] },
        { key: 'COMEDY_DRAMEDY', name: 'Dramedy', emoji: '😊😢', parentGenreId: 35, keywordIds: [203322] },
    ],

    // Action (28)
    28: [
        { key: 'ACTION_SUPERHERO', name: 'Superhero', emoji: '🦸', parentGenreId: 28, keywordIds: [9715] },
        { key: 'ACTION_SPY', name: 'Spy/Espionage', emoji: '🕵️', parentGenreId: 28, keywordIds: [470] },
        { key: 'ACTION_MILITARY', name: 'Military', emoji: '🎖️', parentGenreId: 28, keywordIds: [162365] },
        { key: 'ACTION_MARTIAL_ARTS', name: 'Martial Arts', emoji: '🥋', parentGenreId: 28, keywordIds: [779] },
        { key: 'ACTION_HEIST', name: 'Heist', emoji: '💰', parentGenreId: 28, keywordIds: [10051] },
        { key: 'ACTION_CAR_CHASE', name: 'Car Chase/Racing', emoji: '🏎️', parentGenreId: 28, keywordIds: [357378] },
        { key: 'ACTION_DISASTER', name: 'Disaster', emoji: '🌋', parentGenreId: 28, keywordIds: [10617] },
        { key: 'ACTION_BUDDY_COP', name: 'Buddy Cop', emoji: '👮👮', parentGenreId: 28, keywordIds: [167316] },
        { key: 'ACTION_REVENGE', name: 'Revenge', emoji: '💢', parentGenreId: 28, keywordIds: [9748] },
    ],

    // Drama (18)
    18: [
        { key: 'DRAMA_PSYCHOLOGICAL', name: 'Psychological', emoji: '🧠', parentGenreId: 18, keywordIds: [309029] },
        { key: 'DRAMA_HISTORICAL', name: 'Historical', emoji: '📜', parentGenreId: 18, keywordIds: [15126] },
        { key: 'DRAMA_FAMILY', name: 'Family Drama', emoji: '👨‍👩‍👧', parentGenreId: 18, keywordIds: [12279] },
        { key: 'DRAMA_COMING_OF_AGE', name: 'Coming of Age', emoji: '🌱', parentGenreId: 18, keywordIds: [10683] },
        { key: 'DRAMA_ROMANTIC', name: 'Romantic Drama', emoji: '💔', parentGenreId: 18, keywordIds: [304976] },
        { key: 'DRAMA_COURTROOM', name: 'Courtroom', emoji: '⚖️', parentGenreId: 18, keywordIds: [214780] },
        { key: 'DRAMA_SPORTS', name: 'Sports Drama', emoji: '🏆', parentGenreId: 18, keywordIds: [294708] },
        { key: 'DRAMA_WAR', name: 'War Drama', emoji: '⚔️', parentGenreId: 18, keywordIds: [324284] },
        { key: 'DRAMA_BIOGRAPHICAL', name: 'Biographical', emoji: '📖', parentGenreId: 18, keywordIds: [5565] },
    ],

    // Animation (16)
    16: [
        { key: 'ANIME_SCIFI', name: 'Anime Sci-Fi', emoji: '🎌🚀', parentGenreId: 16, keywordIds: [210024] },
        { key: 'ANIME_MECHA', name: 'Mecha', emoji: '🤖', parentGenreId: 16, keywordIds: [10046] },
        { key: 'ANIME_SHONEN', name: 'Shonen', emoji: '⚔️', parentGenreId: 16, keywordIds: [363152] },
        { key: 'ANIME_SLICE_OF_LIFE', name: 'Slice of Life', emoji: '🌸', parentGenreId: 16, keywordIds: [9914] },
        { key: 'ANIME_ISEKAI', name: 'Isekai', emoji: '🌀', parentGenreId: 16, keywordIds: [237451] },
        { key: 'ANIMATION_PIXAR', name: 'Pixar Style', emoji: '🎬', parentGenreId: 16, keywordIds: [338822] },
        { key: 'ANIMATION_STOP_MOTION', name: 'Stop Motion', emoji: '🎭', parentGenreId: 16, keywordIds: [10121] },
        { key: 'ANIMATION_ADULT', name: 'Adult Animation', emoji: '🔞', parentGenreId: 16, keywordIds: [161919] },
    ],

    // Documentary (99)
    99: [
        { key: 'DOC_TRUE_CRIME', name: 'True Crime', emoji: '🔍', parentGenreId: 99, keywordIds: [33722] },
        { key: 'DOC_NATURE', name: 'Nature', emoji: '🦁', parentGenreId: 99, keywordIds: [221355] },
        { key: 'DOC_MUSIC', name: 'Music', emoji: '🎵', parentGenreId: 99, keywordIds: [246377] },
        { key: 'DOC_SPORTS', name: 'Sports', emoji: '⚽', parentGenreId: 99, keywordIds: [159290] },
        { key: 'DOC_POLITICAL', name: 'Political', emoji: '🏛️', parentGenreId: 99, keywordIds: [239902] },
        { key: 'DOC_FOOD', name: 'Food', emoji: '🍕', parentGenreId: 99, keywordIds: [307690] },
        { key: 'DOC_TRAVEL', name: 'Travel', emoji: '✈️', parentGenreId: 99, keywordIds: [310315] },
        { key: 'DOC_HISTORICAL', name: 'Historical', emoji: '📜', parentGenreId: 99, keywordIds: [321490] },
    ],

    // Fantasy (14)
    14: [
        { key: 'FANTASY_EPIC', name: 'Epic Fantasy', emoji: '⚔️', parentGenreId: 14, keywordIds: [335572] },
        { key: 'FANTASY_DARK', name: 'Dark Fantasy', emoji: '🖤', parentGenreId: 14, keywordIds: [177895] },
        { key: 'FANTASY_URBAN', name: 'Urban Fantasy', emoji: '🌃', parentGenreId: 14, keywordIds: [298549] },
        { key: 'FANTASY_FAIRY_TALE', name: 'Fairy Tale', emoji: '🧚', parentGenreId: 14, keywordIds: [3205] },
        { key: 'FANTASY_MYTHOLOGICAL', name: 'Mythological', emoji: '🏛️', parentGenreId: 14, keywordIds: [207003] },
    ],

    // Romance (10749)
    10749: [
        { key: 'ROMANCE_PERIOD', name: 'Period Romance', emoji: '👗', parentGenreId: 10749, keywordIds: [361772] },
        { key: 'ROMANCE_TRAGIC', name: 'Tragic Romance', emoji: '💔', parentGenreId: 10749, keywordIds: [186956] },
        { key: 'DRAMA_ROMANTIC', name: 'Romantic Drama', emoji: '😢💕', parentGenreId: 10749, keywordIds: [304976] },
    ],
};

// Get all keyword IDs for selected subgenres
export function getKeywordIdsForSubgenres(subgenreKeys: string[]): number[] {
    const keywordIds: number[] = [];
    for (const key of subgenreKeys) {
        const ids = SUBGENRE_TO_KEYWORD_IDS[key];
        if (ids) {
            keywordIds.push(...ids);
        }
    }
    return [...new Set(keywordIds)]; // Deduplicate
}

// Check if a genre has subgenres available
export function hasSubgenres(genreId: number): boolean {
    return !!SUBGENRES_BY_PARENT[genreId] && SUBGENRES_BY_PARENT[genreId].length > 0;
}

// Get subgenres for a parent genre
export function getSubgenresForGenre(genreId: number): SubgenreInfo[] {
    return SUBGENRES_BY_PARENT[genreId] || [];
}
