/**
 * 02-seed-codes.js - Seed CRA T3010 Lookup Tables
 *
 * Populates all reference/lookup tables with official CRA codes.
 * Fully idempotent - uses ON CONFLICT DO UPDATE so it can be re-run safely.
 *
 * Tables seeded:
 *   - cra_category_lookup
 *   - cra_sub_category_lookup
 *   - cra_designation_lookup
 *   - cra_program_type_lookup
 *   - cra_country_lookup
 *   - cra_province_state_lookup
 *
 * Usage: npm run seed-codes
 */
const db = require('../lib/db');
const log = require('../lib/logger');

// ─── Categories (28 + 2 entries) ────────────────────────────────────────────
const CATEGORIES = [
  { code: '0001', name_en: 'Organizations Relieving Poverty', name_fr: 'Organismes qui soulagent la pauvret\u00e9' },
  { code: '0002', name_en: 'Foundations Relieving Poverty', name_fr: 'Fondations qui soulagent la pauvret\u00e9' },
  { code: '0010', name_en: 'Teaching Institutions', name_fr: "Institutions d'enseignement" },
  { code: '0011', name_en: 'Support of schools and education', name_fr: "Soutien aux \u00e9coles et \u00e0 l'\u00e9ducation" },
  { code: '0012', name_en: 'Education in the arts', name_fr: '\u00c9ducation dans le domaine des arts' },
  { code: '0013', name_en: 'Educational organizations not elsewhere categorized', name_fr: 'Organismes \u00e9ducatifs non r\u00e9pertori\u00e9s ailleurs' },
  { code: '0014', name_en: 'Research', name_fr: 'Recherche' },
  { code: '0015', name_en: 'Foundations Advancing Education', name_fr: "Fondations qui servent \u00e0 l'avancement de l'\u00e9ducation" },
  { code: '0030', name_en: 'Christianity', name_fr: 'Christianisme' },
  { code: '0040', name_en: 'Islam', name_fr: 'Islam' },
  { code: '0050', name_en: 'Judaism', name_fr: 'Juda\u00efsme' },
  { code: '0060', name_en: 'Other Religions', name_fr: 'Autres religions' },
  { code: '0070', name_en: 'Support of Religion', name_fr: 'Les organismes de soutien religieux' },
  { code: '0080', name_en: 'Ecumenical and Inter-faith Organizations', name_fr: 'Organismes inter-religieux et \u0153cum\u00e9niques' },
  { code: '0090', name_en: 'Foundations Advancing Religions', name_fr: 'Fondations qui avancent la religion' },
  { code: '0100', name_en: 'Core Health Care', name_fr: 'Soins de sant\u00e9 essentiels' },
  { code: '0110', name_en: 'Supportive Health Care', name_fr: 'Soins de sant\u00e9 de soutien' },
  { code: '0120', name_en: 'Protective Health Care', name_fr: 'Soins relatifs \u00e0 la protection de la sant\u00e9' },
  { code: '0130', name_en: 'Health Care Products', name_fr: 'Produits de soins de sant\u00e9' },
  { code: '0140', name_en: 'Complementary or Alternative Health Care', name_fr: 'Soins de sant\u00e9 compl\u00e9mentaires ou parall\u00e8les' },
  { code: '0150', name_en: 'Relief of the Aged', name_fr: 'Secours aux personnes \u00e2g\u00e9es' },
  { code: '0155', name_en: 'Upholding Human Rights', name_fr: 'Respect des droits de la personne' },
  { code: '0160', name_en: 'Community Resource', name_fr: 'Ressources communautaires' },
  { code: '0170', name_en: 'Environment', name_fr: 'Environnement' },
  { code: '0175', name_en: 'Agriculture', name_fr: 'Agriculture' },
  { code: '0180', name_en: 'Animal Welfare', name_fr: 'Protection des animaux' },
  { code: '0190', name_en: 'Arts', name_fr: 'Artistiques' },
  { code: '0200', name_en: 'Public Amenities', name_fr: 'Services publics' },
  { code: '0210', name_en: 'Foundations', name_fr: 'Fondations' },
  { code: '0215', name_en: 'NASO', name_fr: 'OSNA' },
];

// ─── Sub-Categories (from CRA CODES.md - exact official text) ───────────────
const SUB_CATEGORIES = [
  // 0001 - Organizations Relieving Poverty (CRA CODES.md section 2.2.1)
  { cat: '0001', sub: '0001', name_en: 'Facilitator organization supporting, improving, and enhancing the work of groups involved in the relief of poverty', name_fr: 'Organisme-cadre qui appuie et am\u00e9liore le travail de groupes impliqu\u00e9s dans le soulagement de la pauvret\u00e9' },
  { cat: '0001', sub: '0002', name_en: 'Humanitarian assistance (outside of Canada)', name_fr: "Aide humanitaire (\u00e0 l'ext\u00e9rieur du Canada)" },
  { cat: '0001', sub: '0003', name_en: 'Medical services not otherwise covered by basic health care (dental / optometry / counselling)', name_fr: "Services m\u00e9dicaux non-couverts par un r\u00e9gime d'assurance-maladie de base (soins dentaires / optom\u00e9trie / counseling)" },
  { cat: '0001', sub: '0004', name_en: 'Operating a food bank', name_fr: 'Op\u00e9rer une banque alimentaire' },
  { cat: '0001', sub: '0005', name_en: 'Operating a micro-lending program', name_fr: 'Op\u00e9rer un programme de micro-pr\u00eats' },
  { cat: '0001', sub: '0006', name_en: 'Operating a shelter', name_fr: 'Op\u00e9rer un refuge pour les sans-abri' },
  { cat: '0001', sub: '0007', name_en: 'Orphanage', name_fr: 'Orphelinat' },
  { cat: '0001', sub: '0008', name_en: 'Pro-bono legal services', name_fr: 'Services juridiques pro bono' },
  { cat: '0001', sub: '0009', name_en: 'Providing low-cost housing', name_fr: 'Fournir des logements \u00e0 loyer modique' },
  { cat: '0001', sub: '0010', name_en: 'Providing meals (including breakfast programs)', name_fr: 'Fournir des repas (y compris les programmes de petit-d\u00e9jeuner)' },
  { cat: '0001', sub: '0011', name_en: 'Providing medical equipment and supplies', name_fr: "Fournir de l'\u00e9quipement m\u00e9dical et des fournitures" },
  { cat: '0001', sub: '0012', name_en: 'Providing household items (furniture / appliances)', name_fr: 'Fournir des articles de maison (meubles / \u00e9lectrom\u00e9nagers)' },
  { cat: '0001', sub: '0013', name_en: 'Providing material assistance (clothing / computers / equipment)', name_fr: "Fournir de l'aide mat\u00e9rielle (v\u00eatements / ordinateurs / \u00e9quipements)" },
  { cat: '0001', sub: '0014', name_en: 'Providing work related clothing / career development tools / work integration (resume writing / interview tips)', name_fr: "Fournir v\u00eatements de travail / int\u00e9gration au march\u00e9 du travail (r\u00e9daction de CV / aide pour entrevues)" },
  { cat: '0001', sub: '0015', name_en: 'Refugee (support and settlement assistance)', name_fr: 'R\u00e9fugi\u00e9s / aide aux immigrants dans la pauvret\u00e9' },
  { cat: '0001', sub: '0099', name_en: 'Other', name_fr: 'Autre' },
  // 0002 - Foundations Relieving Poverty
  { cat: '0002', sub: '0001', name_en: 'Foundations for specified poverty charities', name_fr: 'Fondations pour organismes de bienfaisance sp\u00e9cifiques - pauvret\u00e9' },
  { cat: '0002', sub: '0002', name_en: 'Foundations funding poverty QDs in general', name_fr: 'Fondations versant des fonds \u00e0 des DR en g\u00e9n\u00e9ral - pauvret\u00e9' },
  // 0010 - Teaching Institutions
  { cat: '0010', sub: '0001', name_en: 'Preschool (early-childhood education / junior kindergarten)', name_fr: 'Pr\u00e9scolaire (petite enfance / pr\u00e9maternelle)' },
  { cat: '0010', sub: '0002', name_en: 'Kindergarten', name_fr: 'Maternelle' },
  { cat: '0010', sub: '0003', name_en: 'Public elementary school', name_fr: '\u00c9cole primaire publique' },
  { cat: '0010', sub: '0004', name_en: 'Independent elementary schools (includes religious)', name_fr: '\u00c9cole primaire ind\u00e9pendante (y compris religieuse)' },
  { cat: '0010', sub: '0005', name_en: 'Public middle school', name_fr: '\u00c9cole interm\u00e9diaire publique' },
  { cat: '0010', sub: '0006', name_en: 'Independent middle school (including religious)', name_fr: '\u00c9cole interm\u00e9diaire ind\u00e9pendante (y compris religieuse)' },
  { cat: '0010', sub: '0007', name_en: 'Public secondary school', name_fr: '\u00c9cole secondaire publique' },
  { cat: '0010', sub: '0008', name_en: 'Independent secondary school (including religious)', name_fr: '\u00c9cole secondaire ind\u00e9pendante (y compris religieuse)' },
  { cat: '0010', sub: '0009', name_en: 'Public district board (all grades)', name_fr: 'Conseil scolaire publique (tous les niveaux)' },
  { cat: '0010', sub: '0010', name_en: 'Catholic district / separate school board (all grades)', name_fr: 'Conseil scolaire catholique / s\u00e9par\u00e9 (tous les niveaux)' },
  { cat: '0010', sub: '0011', name_en: 'School association / board / district', name_fr: "Association d'\u00e9cole / conseil / district" },
  { cat: '0010', sub: '0012', name_en: 'Schools for students with intellectual disabilities (physical / communicative / mental or social learning difficulties)', name_fr: "\u00c9cole pour \u00e9tudiants ayant des besoins sp\u00e9ciaux (difficult\u00e9s d'apprentissage / physique/ communication / mental ou social)" },
  { cat: '0010', sub: '0013', name_en: 'Vocational / technical school', name_fr: 'Formation professionnelle / technique' },
  { cat: '0010', sub: '0014', name_en: 'College (includes religious)', name_fr: 'Coll\u00e8ge (y compris religieux)' },
  { cat: '0010', sub: '0015', name_en: 'University (includes religious)', name_fr: 'Universit\u00e9 (y compris religieux)' },
  { cat: '0010', sub: '0016', name_en: 'Educational camps', name_fr: 'Camps \u00e9ducatifs' },
  { cat: '0010', sub: '0099', name_en: 'Other', name_fr: 'Autre' },
  // 0011 - Support of schools and education
  { cat: '0011', sub: '0001', name_en: 'School councils (parent-teacher associations)', name_fr: 'Conseils / associations parentsenseignants' },
  { cat: '0011', sub: '0002', name_en: 'Tutoring programs or services', name_fr: 'Programmes ou services de tutorat' },
  { cat: '0011', sub: '0003', name_en: 'Scholarships / bursaries / awards (scholastic achievement)', name_fr: 'Bourses / prix (de r\u00e9ussite scolaire)' },
  { cat: '0011', sub: '0004', name_en: 'Literary / debating society', name_fr: "Soci\u00e9t\u00e9 litt\u00e9raire / d'art oratoire" },
  { cat: '0011', sub: '0005', name_en: 'Literacy groups', name_fr: "Groupes d'alphab\u00e9tisation" },
  { cat: '0011', sub: '0006', name_en: 'Construction of schools / Renovations / building supplies', name_fr: "Construction d'\u00e9coles / fournitures scolaires" },
  { cat: '0011', sub: '0007', name_en: 'Educational aids / school supplies', name_fr: "Soutien \u00e0 l'\u00e9ducation / fournitures scolaires" },
  { cat: '0011', sub: '0008', name_en: 'Fund for specific college / university / school', name_fr: 'Fonds pour coll\u00e8ge / universit\u00e9 / \u00e9cole sp\u00e9cifique' },
  { cat: '0011', sub: '0009', name_en: 'Facilitator organization supporting and enhancing the work of groups involved in the advancement of education', name_fr: "Organisme-cadre qui appuie et am\u00e9liore le travail de groupes impliqu\u00e9s dans l'avancement de l'\u00e9ducation" },
  { cat: '0011', sub: '0099', name_en: 'Other', name_fr: 'Autre' },
  // 0012 - Education in the arts
  { cat: '0012', sub: '0001', name_en: 'Art school (painting / sculpture / drawing / forms of visual arts)', name_fr: "\u00c9cole d'arts (peinture / sculpture / dessin / arts visuels)" },
  { cat: '0012', sub: '0002', name_en: 'Music conservatory / school / society', name_fr: 'Conservatoire / \u00e9cole / soci\u00e9t\u00e9 de musique' },
  { cat: '0012', sub: '0003', name_en: 'Theatre / film / drama school / society / company', name_fr: "Th\u00e9\u00e2tre / \u00c9cole de th\u00e9\u00e2tre / compagnie ou soci\u00e9t\u00e9 d'art dramatique" },
  { cat: '0012', sub: '0004', name_en: 'Scholarships / bursaries / awards (studying performance arts)', name_fr: 'Bourses / prix (pour \u00e9tudes en arts de la sc\u00e8ne)' },
  { cat: '0012', sub: '0099', name_en: 'Other', name_fr: 'Autre' },
  // 0013 - Educational organizations not elsewhere categorized
  { cat: '0013', sub: '0001', name_en: 'Cadets', name_fr: 'Cadets' },
  { cat: '0013', sub: '0002', name_en: 'Guides', name_fr: 'Guides' },
  { cat: '0013', sub: '0003', name_en: 'Scouts', name_fr: 'Scouts' },
  { cat: '0013', sub: '0099', name_en: 'Other', name_fr: 'Autre' },
  // 0014 - Research
  { cat: '0014', sub: '0001', name_en: 'Medical research (health sciences / disease)', name_fr: 'Recherche m\u00e9dicale (sciences de sant\u00e9 / maladie)' },
  { cat: '0014', sub: '0002', name_en: 'Environmental research (ecosystem / conservation / wildlife)', name_fr: 'Recherche environnementale (\u00e9cosyst\u00e8mes / conservation / faune)' },
  { cat: '0014', sub: '0003', name_en: 'Social sciences / humanities research (politics / law / linguistics / economics / psychology)', name_fr: 'Recherche en sciences sociales et humaines (politique / droit / linguistique / \u00e9conomie / psychologie)' },
  { cat: '0014', sub: '0004', name_en: 'Public policy research institutes economic / social policy', name_fr: 'Instituts de recherche en politique publique / politique sociale' },
  { cat: '0014', sub: '0005', name_en: 'Scholarships / bursaries / awards (for conducting research)', name_fr: 'Bourses / prix pour effectuer de la recherche' },
  { cat: '0014', sub: '0006', name_en: 'Sciences / physics / chemistry', name_fr: 'Sciences / physique / chimie' },
  { cat: '0014', sub: '0099', name_en: 'Other', name_fr: 'Autre' },
  // 0015 - Foundations Advancing Education
  { cat: '0015', sub: '0001', name_en: 'Foundations for specified educational charities', name_fr: 'Fondations pour organismes de bienfaisance sp\u00e9cifiques - \u00e9ducation' },
  { cat: '0015', sub: '0002', name_en: 'Foundations funding educational QDs in general', name_fr: 'Fondations versant des fonds \u00e0 des DR en g\u00e9n\u00e9ral - \u00e9ducation' },
  // 0030 - Christianity
  { cat: '0030', sub: '0001', name_en: 'Adventist', name_fr: 'Adventiste' },
  { cat: '0030', sub: '0002', name_en: 'Anglican', name_fr: 'Anglicane' },
  { cat: '0030', sub: '0003', name_en: 'Apostolic', name_fr: 'Apostolique' },
  { cat: '0030', sub: '0004', name_en: 'Baptist', name_fr: 'Baptistes' },
  { cat: '0030', sub: '0005', name_en: 'Catholic', name_fr: 'Catholiques' },
  { cat: '0030', sub: '0006', name_en: 'Church of Christ', name_fr: '\u00c9glise du Christ' },
  { cat: '0030', sub: '0007', name_en: 'Gospel', name_fr: '\u00c9vangile' },
  { cat: '0030', sub: '0008', name_en: "Jehovah's Witnesses", name_fr: 'Congr\u00e9gations T\u00e9moins de J\u00e9hovah' },
  { cat: '0030', sub: '0009', name_en: 'Mennonite / Brethren / Hutterite', name_fr: 'M\u00e9nnonites / Fr\u00e8res / Hutterite' },
  { cat: '0030', sub: '0010', name_en: 'Orthodox', name_fr: 'Orthodoxe' },
  { cat: '0030', sub: '0011', name_en: 'Pentecostal', name_fr: 'Pentec\u00f4tiste' },
  { cat: '0030', sub: '0012', name_en: 'Presbyterian', name_fr: 'Presbyt\u00e9riennes' },
  { cat: '0030', sub: '0013', name_en: 'Protestant', name_fr: 'Protestant' },
  { cat: '0030', sub: '0014', name_en: 'Salvation Army Temples', name_fr: "Temples de l'Arm\u00e9e du Salut" },
  { cat: '0030', sub: '0015', name_en: 'United', name_fr: 'Unie' },
  { cat: '0030', sub: '0099', name_en: 'Other', name_fr: 'Autre' },
  // 0040 - Islam
  { cat: '0040', sub: '0001', name_en: 'Ahmadi', name_fr: 'Ahmadi' },
  { cat: '0040', sub: '0002', name_en: 'Alevi', name_fr: 'Al\u00e9vie' },
  { cat: '0040', sub: '0003', name_en: 'Ismaili', name_fr: 'Ismaili' },
  { cat: '0040', sub: '0004', name_en: 'Salafi / Wahhabi', name_fr: 'Salafi / Wahhabi' },
  { cat: '0040', sub: '0005', name_en: 'Shia', name_fr: 'Shia / Chiite' },
  { cat: '0040', sub: '0006', name_en: 'Sufi', name_fr: 'Soufie' },
  { cat: '0040', sub: '0007', name_en: 'Sunni', name_fr: 'Sunnite' },
  { cat: '0040', sub: '0099', name_en: 'Other', name_fr: 'Autre' },
  // 0050 - Judaism
  { cat: '0050', sub: '0001', name_en: 'Conservative', name_fr: 'Conservateur' },
  { cat: '0050', sub: '0002', name_en: 'Kabbalah', name_fr: 'Kabbale' },
  { cat: '0050', sub: '0003', name_en: 'Orthodox', name_fr: 'Orthodoxe' },
  { cat: '0050', sub: '0004', name_en: 'Reform', name_fr: 'R\u00e9forme' },
  { cat: '0050', sub: '0099', name_en: 'Other', name_fr: 'Autre' },
  // 0060 - Other Religions
  { cat: '0060', sub: '0001', name_en: "Baha'i", name_fr: 'Baha\u00efs' },
  { cat: '0060', sub: '0002', name_en: 'Buddhism', name_fr: 'Bouddhisme' },
  { cat: '0060', sub: '0003', name_en: 'Hinduism', name_fr: 'Hindouisme' },
  { cat: '0060', sub: '0004', name_en: 'Jainism', name_fr: 'Ja\u00efnisme' },
  { cat: '0060', sub: '0005', name_en: 'Sikhism', name_fr: 'Sikhisme' },
  { cat: '0060', sub: '0006', name_en: 'Zoroastrianism', name_fr: 'Zoroastrisme' },
  { cat: '0060', sub: '0099', name_en: 'Other', name_fr: 'Autre' },
  // 0070 - Support of Religion
  { cat: '0070', sub: '0001', name_en: 'Cemeteries (religious)', name_fr: 'Cimeti\u00e8res (religieux)' },
  { cat: '0070', sub: '0002', name_en: 'Convents and Monasteries', name_fr: 'Couvents et monast\u00e8res' },
  { cat: '0070', sub: '0003', name_en: 'Counselling (faith based)', name_fr: 'Counseling (bas\u00e9e sur la foi)' },
  { cat: '0070', sub: '0004', name_en: 'Crusade - one-time event', name_fr: 'Croisade - \u00e9v\u00e9nement unique' },
  { cat: '0070', sub: '0005', name_en: 'Mission / Missionary organization', name_fr: 'Mission / association \u00e9vang\u00e9lique' },
  { cat: '0070', sub: '0006', name_en: 'Fund / endowment for specific faith based organization', name_fr: 'Fondation / dotation pour une \u00e9glise en particulier' },
  { cat: '0070', sub: '0007', name_en: 'Music - ministries / religious festivals', name_fr: 'Musique - minist\u00e8res / f\u00eates religieuses' },
  { cat: '0070', sub: '0008', name_en: 'Language translation - enable the reading of sacred text', name_fr: 'Traduction de textes sacr\u00e9s' },
  { cat: '0070', sub: '0009', name_en: 'Library - spiritual and educational resources', name_fr: 'Biblioth\u00e8que - ressources spirituelles et \u00e9ducatives' },
  { cat: '0070', sub: '0010', name_en: 'Pastoral care - hospice / hospital / prison', name_fr: 'Soins pastoraux - hospice / h\u00f4pital / prison' },
  { cat: '0070', sub: '0011', name_en: 'Pilgrimages', name_fr: 'P\u00e8lerinages' },
  { cat: '0070', sub: '0012', name_en: 'Prayer fellowships / ministries / circles', name_fr: 'Groupes de pri\u00e8re / minist\u00e8res / cercles' },
  { cat: '0070', sub: '0013', name_en: 'Providing and maintaining facilities / title-holding entities', name_fr: 'Fournir et maintenir des installations / D\u00e9tention de titres' },
  { cat: '0070', sub: '0014', name_en: 'Religious education classes (bible study)', name_fr: "Cours d'\u00e9ducation religieuse (\u00e9tude de la bible)" },
  { cat: '0070', sub: '0015', name_en: 'Retirement / nursing / rehabilitation etc.', name_fr: 'Soutien \u00e0 la retraite / infirmiers / r\u00e9habilitation, etc.' },
  { cat: '0070', sub: '0016', name_en: 'Retreats - marriage encounter / spiritual / youth', name_fr: 'Retraites - rencontre de mariage / spirituelle / jeunesse' },
  { cat: '0070', sub: '0017', name_en: 'Scholarships / bursaries / awards (religious courses)', name_fr: 'Bourses (cours religieux)' },
  { cat: '0070', sub: '0018', name_en: 'Facilitator organization supporting and enhancing the work of groups involved in the advancement of religion', name_fr: "Organisme-cadre qui appuie et am\u00e9liore le travail de groupes impliqu\u00e9s dans l'avancement de la religion" },
  { cat: '0070', sub: '0019', name_en: 'Youth ministries / camps', name_fr: 'Minist\u00e8res pour les jeunes / camps' },
  { cat: '0070', sub: '0099', name_en: 'Other', name_fr: 'Autre' },
  // 0080 - Ecumenical and Inter-faith Organizations
  { cat: '0080', sub: '0001', name_en: 'Supporting/enhancing the work of religious groups / Collaborating with other denominations / Discussing theological topics', name_fr: 'Appuyer/am\u00e9liorer le travail de groupes religieux / Collaborer avec autres d\u00e9nominations / Discuter de sujets th\u00e9ologiques' },
  // 0090 - Foundations Advancing Religions
  { cat: '0090', sub: '0001', name_en: 'Foundations for specified religious charities', name_fr: 'Fondations pour organismes de bienfaisance sp\u00e9cifiques - religion' },
  { cat: '0090', sub: '0002', name_en: 'Foundations funding religious QDs in general', name_fr: 'Fondations versant des fonds \u00e0 des DR en g\u00e9n\u00e9ral - religion' },
  // 0100 - Core Health Care
  { cat: '0100', sub: '0001', name_en: 'Addiction recovery programs and centres', name_fr: "Programmes et centres d'aide \u00e0 la toxicomanie / alcoolisme / autres d\u00e9pendances" },
  { cat: '0100', sub: '0002', name_en: 'Community health centre / medical clinic', name_fr: 'Centre de sant\u00e9 communautaire / clinique m\u00e9dicale' },
  { cat: '0100', sub: '0003', name_en: 'Dental Clinic', name_fr: 'Clinique dentaire' },
  { cat: '0100', sub: '0004', name_en: 'Counselling or support group programs', name_fr: 'Programmes de counseling ou groupes de soutien' },
  { cat: '0100', sub: '0005', name_en: 'First aid services', name_fr: 'Services de premiers soins' },
  { cat: '0100', sub: '0006', name_en: 'Hospitals (diagnosing and treating health conditions)', name_fr: 'H\u00f4pitaux (diagnostiquer et traiter des conditions de sant\u00e9)' },
  { cat: '0100', sub: '0007', name_en: 'Hospice', name_fr: 'Hospice' },
  { cat: '0100', sub: '0008', name_en: 'Providing home health care', name_fr: 'Fournir des soins de sant\u00e9 \u00e0 domicile' },
  { cat: '0100', sub: '0009', name_en: 'Providing palliative care service', name_fr: 'Fournir des services de soins palliatifs' },
  { cat: '0100', sub: '0010', name_en: 'Providing preventative care', name_fr: 'Fournir des soins pr\u00e9ventifs' },
  { cat: '0100', sub: '0011', name_en: 'Providing psychological counselling', name_fr: 'Fournir des services de counseling psychologique ou des services sociaux' },
  { cat: '0100', sub: '0012', name_en: 'Providing physical, occupational, speech or massage therapy', name_fr: "Fournir des services de physioth\u00e9rapie, d'ergoth\u00e9rapie ou de massoth\u00e9rapie" },
  { cat: '0100', sub: '0013', name_en: 'Rehabilitation programs and centres', name_fr: "Programmes et centres d'aide \u00e0 la r\u00e9habilitation" },
  { cat: '0100', sub: '0014', name_en: 'Treatment / preventative care for specific disease / health condition', name_fr: 'Traitement / soins pr\u00e9ventifs pour une maladie / \u00e9tat de sant\u00e9 sp\u00e9cifique' },
  { cat: '0100', sub: '0099', name_en: 'Other', name_fr: 'Autre' },
  // 0110 - Supportive Health Care
  { cat: '0110', sub: '0001', name_en: 'Accompanying individuals to medical appointment / translate / interpret', name_fr: 'Accompagnement \u00e0 des rendez-vous m\u00e9dicaux / traduire / interpr\u00e9ter' },
  { cat: '0110', sub: '0002', name_en: "Accommodation for hospital patients' visit", name_fr: "H\u00e9bergement pour visiteurs de patients hospitalis\u00e9s" },
  { cat: '0110', sub: '0003', name_en: 'Family planning / birth control / pregnancy crisis counseling', name_fr: 'Planification familiale et conseils sur le contr\u00f4le des naissances' },
  { cat: '0110', sub: '0004', name_en: 'General health promotion / prevention', name_fr: 'Organisme de promotion / pr\u00e9vention de la sant\u00e9' },
  { cat: '0110', sub: '0005', name_en: 'Health Boards - established by province', name_fr: 'Commission de sant\u00e9 - cr\u00e9\u00e9 par la province' },
  { cat: '0110', sub: '0006', name_en: 'Independent living skills (peer support / referrals)', name_fr: 'Am\u00e9liorer l\'autonomie / capacit\u00e9 \u00e0 vivre seul (soutien par les pairs / aiguillage)' },
  { cat: '0110', sub: '0007', name_en: 'Health counselling and group support programs', name_fr: 'Acc\u00e8s \u00e0 des conseils de sant\u00e9 / info / programmes de soutien de groupe' },
  { cat: '0110', sub: '0008', name_en: 'Health Councils - established by province', name_fr: 'Conseil de la sant\u00e9 - cr\u00e9\u00e9 par la province' },
  { cat: '0110', sub: '0009', name_en: 'Health / medical conference / seminars', name_fr: 'Conf\u00e9rence / s\u00e9minaire sur la sant\u00e9 / m\u00e9decine' },
  { cat: '0110', sub: '0010', name_en: 'Hospital auxiliaries', name_fr: 'Auxiliaires b\u00e9n\u00e9voles - dans les h\u00f4pitaux' },
  { cat: '0110', sub: '0011', name_en: 'Providing comfort items (cope with hospitalization / health condition)', name_fr: "Fournir des \u00e9l\u00e9ments de confort (faire face \u00e0 l'hospitalisation / \u00e9tat de sant\u00e9)" },
  { cat: '0110', sub: '0012', name_en: 'Respite for caregivers of persons with serious health conditions', name_fr: 'R\u00e9pit pour les aidants des personnes atteintes de probl\u00e8mes de sant\u00e9 graves' },
  { cat: '0110', sub: '0013', name_en: 'Services that facilitate the delivery of health care', name_fr: 'Services qui facilitent la livraison des soins de sant\u00e9' },
  { cat: '0110', sub: '0014', name_en: 'Services for adults and children with developmental disabilities', name_fr: 'Services pour adultes et enfants ayant des d\u00e9ficiences li\u00e9es au d\u00e9veloppement' },
  { cat: '0110', sub: '0015', name_en: 'Transportation to medical appointments', name_fr: 'Transport aux rendez-vous m\u00e9dicaux' },
  { cat: '0110', sub: '0016', name_en: 'Voluntary Association for specific hospital / home', name_fr: 'Association b\u00e9n\u00e9vole pour un h\u00f4pital en particulier / foyer' },
  { cat: '0110', sub: '0099', name_en: 'Other', name_fr: 'Autre' },
  // 0120 - Protective Health Care
  { cat: '0120', sub: '0001', name_en: 'Ambulance or paramedic services', name_fr: 'Ambulance ou services param\u00e9dicaux' },
  { cat: '0120', sub: '0002', name_en: 'Disaster relief', name_fr: 'Secours aux sinistr\u00e9s' },
  { cat: '0120', sub: '0003', name_en: 'Voluntary Fire-fighting services', name_fr: "Services d'incendie b\u00e9n\u00e9voles" },
  { cat: '0120', sub: '0004', name_en: 'Regulating / governing health care service providers and standards', name_fr: 'R\u00e9glementer / r\u00e9gir les fournisseurs de services de soins de sant\u00e9' },
  { cat: '0120', sub: '0005', name_en: 'Safety council / society', name_fr: 'Conseil de s\u00e9curit\u00e9' },
  { cat: '0120', sub: '0006', name_en: 'Search and rescue / lifesaving services', name_fr: 'Recherche et sauvetage / services de secourisme' },
  { cat: '0120', sub: '0099', name_en: 'Other', name_fr: 'Autre' },
  // 0130 - Health Care Products
  { cat: '0130', sub: '0001', name_en: 'Drugs (radiopharmaceutical / biologics / medicines / vaccines)', name_fr: 'M\u00e9dicaments (radiopharmaceutiques, biologiques, m\u00e9dicaments, vaccins)' },
  { cat: '0130', sub: '0002', name_en: 'Medical equipment / supplies (for use inside or outside Canada)', name_fr: "\u00c9quipement / fournitures m\u00e9dicales (\u00e0 l'int\u00e9rieur ou l'ext\u00e9rieur du Canada)" },
  { cat: '0130', sub: '0003', name_en: 'Providing natural health products', name_fr: 'Fournir des produits de sant\u00e9 naturels' },
  { cat: '0130', sub: '0099', name_en: 'Other', name_fr: 'Autre' },
  // 0140 - Complementary or Alternative Health Care
  { cat: '0140', sub: '0001', name_en: 'Alternative medical services / products (dietary / herbal supplements)', name_fr: 'Services / produits m\u00e9dicaux alternatifs (alimentaires, suppl\u00e9ments de fines herbes)' },
  { cat: '0140', sub: '0002', name_en: 'Energy-based systems (spiritual healing)', name_fr: "Syst\u00e8mes \u00e0 base d'\u00e9nergie (gu\u00e9rison spirituelle)" },
  { cat: '0140', sub: '0003', name_en: 'Manipulative body-based therapy (osteopathy / massage therapy)', name_fr: 'Th\u00e9rapies manuelles et th\u00e9rapies du corps (ost\u00e9opathie, massoth\u00e9rapie)' },
  { cat: '0140', sub: '0004', name_en: 'Mind-body techniques (meditation / acupuncture)', name_fr: 'Techniques corps-esprit (m\u00e9ditation, acupuncture)' },
  { cat: '0140', sub: '0005', name_en: 'Therapeutic programs for persons with disabilities', name_fr: 'Programmes th\u00e9rapeutiques pour personnes handicap\u00e9es' },
  { cat: '0140', sub: '0006', name_en: 'Traditional programs / whole medicine (Chinese / Ayurvedic)', name_fr: 'Programmes traditionnels / m\u00e9decine holistique (Chinois, Ayurv\u00e9dique)' },
  { cat: '0140', sub: '0007', name_en: 'Providing physical fitness and wellness facilities / programs', name_fr: 'Fournir des installations et des programmes de conditionnement physique et de mieux-\u00eatre' },
  { cat: '0140', sub: '0099', name_en: 'Other', name_fr: 'Autre' },
  // 0150 - Relief of the Aged
  { cat: '0150', sub: '0001', name_en: 'Adapting residential accommodation', name_fr: 'Adaptation de logements r\u00e9sidentiels' },
  { cat: '0150', sub: '0002', name_en: 'Home support/services (personal care / meals / housekeeping / shopping assistance / laundry / home repair)', name_fr: 'Soutien/services \u00e0 domicile (hygi\u00e8ne personnelle / repas / aide-m\u00e9nag\u00e8re ou au magasinage / lessive / r\u00e9parations au domicile)' },
  { cat: '0150', sub: '0003', name_en: "Nursing home / senior's home with care", name_fr: "Centre d'h\u00e9bergement / r\u00e9sidence pour a\u00een\u00e9s avec soins infirmiers" },
  { cat: '0150', sub: '0004', name_en: 'Relieving isolation (companionship / accompaniment to social outings)', name_fr: "Briser l'isolement et la solitude (compagnonnage / accompagnement lors de sorties)" },
  { cat: '0150', sub: '0005', name_en: "Seniors' outreach programs (housekeeping / tax preparation, etc.)", name_fr: "Programmes de services aux a\u00een\u00e9s (entretien m\u00e9nager, pr\u00e9paration de d\u00e9clarations d'imp\u00f4t etc.)" },
  { cat: '0150', sub: '0006', name_en: 'Support services to victims of elder abuse / counselling', name_fr: 'Services de soutien et de counseling aux a\u00een\u00e9s victimes de mauvais traitements' },
  { cat: '0150', sub: '0007', name_en: 'Transportation for seniors', name_fr: 'Transport adapt\u00e9 pour a\u00een\u00e9s' },
  { cat: '0150', sub: '0099', name_en: 'Other', name_fr: 'Autre' },
  // 0160 - Community Resource
  { cat: '0160', sub: '0001', name_en: 'Aboriginal programs and services (includes friendship centres)', name_fr: "Programmes et services pour les autochtones (y compris les centres d'amiti\u00e9)" },
  { cat: '0160', sub: '0002', name_en: "Battered women's centre", name_fr: 'Centre / refuge pour femmes battues' },
  { cat: '0160', sub: '0003', name_en: 'Crime prevention / preservation of law & order', name_fr: "Pr\u00e9vention du crime / pr\u00e9servation de la loi et de l'ordre" },
  { cat: '0160', sub: '0004', name_en: 'Community land trust', name_fr: 'Fiducie immobili\u00e8re pour le b\u00e9n\u00e9fice de la communaut\u00e9' },
  { cat: '0160', sub: '0005', name_en: 'Crisis / distress phone line', name_fr: "Ligne t\u00e9l\u00e9phonique d'aide \u00e0 la crise / d\u00e9tresse" },
  { cat: '0160', sub: '0006', name_en: 'Daycare / Nursery / After school care', name_fr: "Garderie de jour / apr\u00e8s l'\u00e9cole" },
  { cat: '0160', sub: '0007', name_en: 'Employment / Job training for people with physical and mental disabilities', name_fr: "Emploi / formation professionnelle \u00e0 l'emploi pour les personnes ayant des d\u00e9ficiences physiques ou mentales" },
  { cat: '0160', sub: '0008', name_en: 'Immigrant services (jobs / language / etc.)', name_fr: 'Services aux immigrants (emploi, langue, etc.)' },
  { cat: '0160', sub: '0009', name_en: 'Legal assistance and services (mediation)', name_fr: 'Aide et services juridiques (m\u00e9diation)' },
  { cat: '0160', sub: '0010', name_en: "Military / family / veterans' support", name_fr: 'Soutien aux militaires / anciens combattants et leurs familles' },
  { cat: '0160', sub: '0011', name_en: 'Missing children organization', name_fr: "Organisme pour la recherche d'enfants disparus" },
  { cat: '0160', sub: '0012', name_en: 'Rape / sexual assault / abuse support', name_fr: 'Soutien aux victimes de viol / abus sexuel' },
  { cat: '0160', sub: '0013', name_en: 'Rehabilitation of offenders', name_fr: 'R\u00e9habilitation des contrevenants' },
  { cat: '0160', sub: '0014', name_en: 'Suicide prevention', name_fr: 'Pr\u00e9vention du suicide' },
  { cat: '0160', sub: '0015', name_en: 'Facilitator organization supporting and enhancing the work of groups involved in the delivery of charitable programs', name_fr: 'Organisme-cadre qui appuie et am\u00e9liore le travail de groupes impliqu\u00e9s dans la prestation de programmes de bienfaisance' },
  { cat: '0160', sub: '0016', name_en: 'Employment counselling / guidance (career)', name_fr: "Conseils et pr\u00e9paration \u00e0 l'emploi (carri\u00e8re)" },
  { cat: '0160', sub: '0017', name_en: 'Employment training / rehabilitation', name_fr: "Formation li\u00e9e \u00e0 l'emploi / r\u00e9adaptation professionnelle" },
  { cat: '0160', sub: '0018', name_en: 'Volunteerism', name_fr: 'B\u00e9n\u00e9volat' },
  { cat: '0160', sub: '0019', name_en: 'Youth programs and services', name_fr: 'Programmes et services pour les jeunes' },
  { cat: '0160', sub: '0099', name_en: 'Other', name_fr: 'Autre' },
  // 0170 - Environment
  { cat: '0170', sub: '0001', name_en: 'Conservation of nature / habitat group / ecosystem preservation etc.', name_fr: "Groupe de protection de la nature / habitat naturel / pr\u00e9servation de l'\u00e9cosyst\u00e8me" },
  { cat: '0170', sub: '0002', name_en: 'Pollution Reduction', name_fr: 'R\u00e9duction de la pollution' },
  { cat: '0170', sub: '0003', name_en: 'Environmental development solutions and technologies', name_fr: 'Solutions et technologies li\u00e9es au d\u00e9veloppement environnemental' },
  { cat: '0170', sub: '0004', name_en: 'Upholding environmental law', name_fr: 'Respect des lois environnementales' },
  { cat: '0170', sub: '0005', name_en: 'Waste management reduction / recycling', name_fr: 'R\u00e9duction des d\u00e9chets / recyclage' },
  { cat: '0170', sub: '0099', name_en: 'Other', name_fr: 'Autre' },
  // 0175 - Agriculture
  { cat: '0175', sub: '0001', name_en: 'Agriculture / farm society or aid / safety', name_fr: 'Soci\u00e9t\u00e9 / aide / s\u00e9curit\u00e9 agricole' },
  { cat: '0175', sub: '0002', name_en: 'Horticultural society', name_fr: "Soci\u00e9t\u00e9 d'horticulture" },
  { cat: '0175', sub: '0099', name_en: 'Other', name_fr: 'Autre' },
  // 0180 - Animal Welfare
  { cat: '0180', sub: '0001', name_en: 'Animal hospital', name_fr: 'H\u00f4pital / clinique v\u00e9t\u00e9rinaire' },
  { cat: '0180', sub: '0002', name_en: 'Animal shelter / neuter / adoption', name_fr: "Refuge d'animaux / st\u00e9rilisation / adoption" },
  { cat: '0180', sub: '0003', name_en: 'Wildlife protection organization', name_fr: 'Organisme de protection de la faune en g\u00e9n\u00e9ral' },
  { cat: '0180', sub: '0004', name_en: 'Rescuing domestic / holding stray / abandoned / surrendered animals', name_fr: 'Sauvetage des animaux d\u00e9laiss\u00e9s / errants' },
  { cat: '0180', sub: '0099', name_en: 'Other', name_fr: 'Autre' },
  // 0190 - Arts
  { cat: '0190', sub: '0001', name_en: 'Arts council (promoting the industry)', name_fr: "Conseil des arts (promotion de l'industrie)" },
  { cat: '0190', sub: '0002', name_en: 'Arts festival', name_fr: 'Festival artistique' },
  { cat: '0190', sub: '0003', name_en: 'Crafts (beadwork / ceramics / furniture / glass / metal / wood / etc.)', name_fr: 'Artisanat (perlage / c\u00e9ramiques / meubles / verre / m\u00e9tal / bois / etc.)' },
  { cat: '0190', sub: '0004', name_en: 'Dance (ballet / classical / jazz / modern / tap / etc.)', name_fr: 'Dance (ballet / classique / jazz / moderne / claquettes / etc.)' },
  { cat: '0190', sub: '0005', name_en: 'Literature (novels / playwriting / poetry / short stories / etc.)', name_fr: 'Litt\u00e9rature (romans / la dramaturgie / la po\u00e9sie / des histoires courtes / etc.)' },
  { cat: '0190', sub: '0006', name_en: 'Media arts (animation / film / screenwriting / etc.)', name_fr: 'Arts m\u00e9diatiques (animation / cin\u00e9ma / \u00e9criture de sc\u00e9nario / etc.)' },
  { cat: '0190', sub: '0007', name_en: 'Music (band / choral / gospel / jazz / opera / orchestral / etc.)', name_fr: 'Musique (groupe / chorale / gospel / jazz / op\u00e9ra / orchestre / etc.)' },
  { cat: '0190', sub: '0008', name_en: 'Music Festival', name_fr: 'Festival de musique' },
  { cat: '0190', sub: '0009', name_en: 'Theatre / performing arts (drama / comedy / musical / puppetry / etc.)', name_fr: 'Th\u00e9\u00e2tre / arts de la sc\u00e8ne (th\u00e9\u00e2tre / com\u00e9die / musique / marionnettes / etc.)' },
  { cat: '0190', sub: '0010', name_en: 'Visual arts (drawing and illustration / painting / photography / etc.)', name_fr: 'Arts visuels (dessin et illustration / peinture / photographie / etc.)' },
  { cat: '0190', sub: '0099', name_en: 'Other', name_fr: 'Autre' },
  // 0200 - Public Amenities
  { cat: '0200', sub: '0001', name_en: 'Aquarium', name_fr: 'Aquarium' },
  { cat: '0200', sub: '0002', name_en: 'Archives', name_fr: 'Archives' },
  { cat: '0200', sub: '0003', name_en: 'Art gallery', name_fr: "Galerie d'art" },
  { cat: '0200', sub: '0004', name_en: 'Botanical garden', name_fr: 'Jardin botanique' },
  { cat: '0200', sub: '0005', name_en: 'Camps / recreation', name_fr: 'Camps / r\u00e9cr\u00e9ation' },
  { cat: '0200', sub: '0006', name_en: 'Cemetery (secular)', name_fr: 'Cimeti\u00e8res s\u00e9culiers' },
  { cat: '0200', sub: '0007', name_en: 'Community Centre / hall', name_fr: 'Centre communautaire / salle' },
  { cat: '0200', sub: '0008', name_en: 'Hall of fame', name_fr: 'Temple de la renomm\u00e9e' },
  { cat: '0200', sub: '0009', name_en: 'Heritage / Historical site', name_fr: 'Site historique / patrimonial' },
  { cat: '0200', sub: '0010', name_en: 'Library', name_fr: 'Biblioth\u00e8que' },
  { cat: '0200', sub: '0011', name_en: 'Memorial', name_fr: 'Monument comm\u00e9moratif' },
  { cat: '0200', sub: '0012', name_en: 'Museum', name_fr: 'Mus\u00e9e' },
  { cat: '0200', sub: '0013', name_en: 'National and provincial parks', name_fr: 'Parcs nationaux ou provinciaux' },
  { cat: '0200', sub: '0014', name_en: 'Nature centre / society / trails', name_fr: 'Centre de la nature / soci\u00e9t\u00e9 / sentiers' },
  { cat: '0200', sub: '0015', name_en: 'Performing arts centre / facility', name_fr: "Centre d'arts / installation" },
  { cat: '0200', sub: '0016', name_en: 'Public recreation / arenas / parks / playgrounds / pools', name_fr: 'Ar\u00e9nas / parc / terrain de jeux communautaire / piscine' },
  { cat: '0200', sub: '0017', name_en: 'Zoo / zoological society', name_fr: 'Zoo / soci\u00e9t\u00e9 zoologique' },
  { cat: '0200', sub: '0099', name_en: 'Other', name_fr: 'Autre' },
  // 0210 - Foundations
  { cat: '0210', sub: '0001', name_en: 'Foundations for specified community benefit', name_fr: 'Fondations pour un b\u00e9n\u00e9fice communautaire d\u00e9sign\u00e9' },
  { cat: '0210', sub: '0002', name_en: 'Foundations funding community benefit QDs in general', name_fr: 'Fondations pour DR qui \u0153uvrent pour le b\u00e9n\u00e9fice communautaire' },
  // 0215 - NASO
  { cat: '0215', sub: '0001', name_en: 'NASO', name_fr: 'OSNA' },
];

// ─── Designations (3 entries) ───────────────────────────────────────────────
const DESIGNATIONS = [
  { code: 'A', name_en: 'Public Foundation', name_fr: 'Fondation publique', desc_en: "More than 50% of directors deal at arm's length with each other and more than 50% of funding comes from arm's length sources" },
  { code: 'B', name_en: 'Private Foundation', name_fr: 'Fondation priv\u00e9e', desc_en: "More than 50% of directors do not deal at arm's length with each other or more than 50% of funding comes from non-arm's length sources" },
  { code: 'C', name_en: 'Charitable Organization', name_fr: 'Organisme de bienfaisance', desc_en: 'More than 50% of income is spent on charitable activities carried on by the charity itself' },
];

// ─── Program Types (3 entries) ──────────────────────────────────────────────
const PROGRAM_TYPES = [
  { code: 'OP', name_en: 'Ongoing Program', name_fr: 'Programme continu', desc_en: 'Programs that continue from previous years' },
  { code: 'NP', name_en: 'New Program', name_fr: 'Nouveau programme', desc_en: 'Programs that are new this fiscal year' },
  { code: 'NA', name_en: 'Not Active', name_fr: 'Non actif', desc_en: 'Programs that are no longer active' },
];

// ─── Countries (ISO 3166-1 alpha-2 + CRA custom codes) ─────────────────────
const COUNTRIES = [
  { code: 'AD', name_en: 'Andorra', name_fr: 'Andorre' },
  { code: 'AE', name_en: 'United Arab Emirates', name_fr: 'Émirats Arabes Unis' },
  { code: 'AF', name_en: 'Afghanistan', name_fr: 'Afghanistan' },
  { code: 'AG', name_en: 'Antigua and Barbuda', name_fr: 'Antigua et Barbuda' },
  { code: 'AI', name_en: 'Anguilla', name_fr: 'Anguilla' },
  { code: 'AL', name_en: 'Albania', name_fr: 'Albanie' },
  { code: 'AM', name_en: 'Armenia', name_fr: 'Arménie' },
  { code: 'AN', name_en: 'Netherlands Antilles', name_fr: 'Antilles Néerlandaises' },
  { code: 'AO', name_en: 'Angola', name_fr: 'Angola' },
  { code: 'AQ', name_en: 'Antarctica', name_fr: 'Antarctique' },
  { code: 'AR', name_en: 'Argentina', name_fr: 'Argentine' },
  { code: 'AS', name_en: 'American Samoa', name_fr: 'Samoa américaines' },
  { code: 'AT', name_en: 'Austria', name_fr: 'Autriche' },
  { code: 'AU', name_en: 'Australia', name_fr: 'Australie' },
  { code: 'AW', name_en: 'Aruba', name_fr: 'Aruba' },
  { code: 'AX', name_en: 'Aland Islands', name_fr: 'Åland, Iles' },
  { code: 'AZ', name_en: 'Azerbaijan', name_fr: 'Azerbaïdjan' },
  { code: 'BA', name_en: 'Bosnia-Herzegovina', name_fr: 'Bosnie-Herzégovine' },
  { code: 'BB', name_en: 'Barbados', name_fr: 'Barbade' },
  { code: 'BD', name_en: 'Bangladesh', name_fr: 'Bangladesh' },
  { code: 'BE', name_en: 'Belgium', name_fr: 'Belgique' },
  { code: 'BF', name_en: 'Burkina Faso', name_fr: 'Burkina Faso' },
  { code: 'BG', name_en: 'Bulgaria', name_fr: 'Bulgarie' },
  { code: 'BH', name_en: 'Bahrain', name_fr: 'Bahreïn' },
  { code: 'BI', name_en: 'Burundi', name_fr: 'Burundi' },
  { code: 'BJ', name_en: 'Benin', name_fr: 'Bénin' },
  { code: 'BL', name_en: 'Saint-Barthelemy', name_fr: 'Saint Barthélemy' },
  { code: 'BM', name_en: 'Bermuda', name_fr: 'Bermudes' },
  { code: 'BN', name_en: 'Brunei Darussalam', name_fr: 'Brunei Darussalam' },
  { code: 'BO', name_en: 'Bolivia', name_fr: 'Bolivie' },
  { code: 'BQ', name_en: 'Bonaire, St Eustatius and Saba', name_fr: 'Bonaire, Saint-Eustache et Saba' },
  { code: 'BR', name_en: 'Brazil', name_fr: 'Brésil' },
  { code: 'BS', name_en: 'Bahamas', name_fr: 'Bahamas' },
  { code: 'BT', name_en: 'Bhutan', name_fr: 'Bhoutan' },
  { code: 'BV', name_en: 'Bouvet Island', name_fr: 'Bouvet, Ile' },
  { code: 'BW', name_en: 'Botswana', name_fr: 'Botswana' },
  { code: 'BY', name_en: 'Belarus', name_fr: 'Belarus' },
  { code: 'BZ', name_en: 'Belize', name_fr: 'Belize' },
  { code: 'CA', name_en: 'Canada', name_fr: 'Canada' },
  { code: 'CC', name_en: 'Cocos (Keeling) Islands', name_fr: 'Cocos (Keeling), Iles des' },
  { code: 'CD', name_en: 'Congo, Democratic Republic', name_fr: 'Congo, République démocratique' },
  { code: 'CF', name_en: 'Central African Republic', name_fr: 'Centrafricaine, République' },
  { code: 'CG', name_en: 'Congo', name_fr: 'Congo' },
  { code: 'CH', name_en: 'Switzerland', name_fr: 'Suisse' },
  { code: 'CI', name_en: 'Côte d\'Ivoire', name_fr: 'Côte d\'Ivoire' },
  { code: 'CK', name_en: 'Cook Islands', name_fr: 'Cook, Iles' },
  { code: 'CL', name_en: 'Chile', name_fr: 'Chili' },
  { code: 'CM', name_en: 'Cameroon', name_fr: 'Cameroun' },
  { code: 'CN', name_en: 'China', name_fr: 'Chine' },
  { code: 'CO', name_en: 'Colombia', name_fr: 'Colombie' },
  { code: 'CR', name_en: 'Costa Rica', name_fr: 'Costa Rica' },
  { code: 'CS', name_en: 'Serbia and Montenegro', name_fr: 'Serbie-et-Monténégro' },
  { code: 'CU', name_en: 'Cuba', name_fr: 'Cuba' },
  { code: 'CV', name_en: 'Cape Verde', name_fr: 'Cap-Vert' },
  { code: 'CW', name_en: 'Curacao', name_fr: 'Curaçao' },
  { code: 'CX', name_en: 'Christmas Island', name_fr: 'Christmas, Ile' },
  { code: 'CY', name_en: 'Cyprus', name_fr: 'Chypre' },
  { code: 'CZ', name_en: 'Czech Republic', name_fr: 'Tchèque, République' },
  { code: 'DE', name_en: 'Germany', name_fr: 'Allemagne' },
  { code: 'DJ', name_en: 'Djibouti', name_fr: 'Djibouti' },
  { code: 'DK', name_en: 'Denmark', name_fr: 'Danemark' },
  { code: 'DM', name_en: 'Dominica', name_fr: 'Dominique' },
  { code: 'DO', name_en: 'Dominican Republic', name_fr: 'Dominicaine, République' },
  { code: 'DZ', name_en: 'Algeria', name_fr: 'Algérie' },
  { code: 'EC', name_en: 'Ecuador', name_fr: 'Équateur' },
  { code: 'EE', name_en: 'Estonia', name_fr: 'Estonie' },
  { code: 'EG', name_en: 'Egypt', name_fr: 'Égypte' },
  { code: 'EH', name_en: 'Western Sahara', name_fr: 'Sahara occidental' },
  { code: 'ER', name_en: 'Eritrea', name_fr: 'Érythrée' },
  { code: 'ES', name_en: 'Spain', name_fr: 'Espagne' },
  { code: 'ET', name_en: 'Ethiopia', name_fr: 'Éthiopie' },
  { code: 'FI', name_en: 'Finland', name_fr: 'Finlande' },
  { code: 'FJ', name_en: 'Fiji', name_fr: 'Fidji' },
  { code: 'FK', name_en: 'Falkland Islands (Malvinas)', name_fr: 'Falkland, Iles (Malvinas)' },
  { code: 'FM', name_en: 'Micronesia, Federated States', name_fr: 'Micronésie' },
  { code: 'FO', name_en: 'Faroe Islands', name_fr: 'Féroé, Iles' },
  { code: 'FR', name_en: 'France', name_fr: 'France' },
  { code: 'GA', name_en: 'Gabon', name_fr: 'Gabon' },
  { code: 'GB', name_en: 'United Kingdom', name_fr: 'Royaume-Uni' },
  { code: 'GD', name_en: 'Grenada', name_fr: 'Grenade' },
  { code: 'GE', name_en: 'Georgia', name_fr: 'Géorgie' },
  { code: 'GF', name_en: 'French Guiana', name_fr: 'Guyane Française' },
  { code: 'GG', name_en: 'Guernsey', name_fr: 'Guernesey' },
  { code: 'GH', name_en: 'Ghana', name_fr: 'Ghana' },
  { code: 'GI', name_en: 'Gibraltar', name_fr: 'Gibraltar' },
  { code: 'GL', name_en: 'Greenland', name_fr: 'Groenland' },
  { code: 'GM', name_en: 'Gambia', name_fr: 'Gambie' },
  { code: 'GN', name_en: 'Guinea', name_fr: 'Guinée' },
  { code: 'GP', name_en: 'Guadeloupe', name_fr: 'Guadeloupe' },
  { code: 'GQ', name_en: 'Equatorial Guinea', name_fr: 'Guinée équatoriale' },
  { code: 'GR', name_en: 'Greece', name_fr: 'Grèce' },
  { code: 'GS', name_en: 'South Georgia/South Sandwich Island', name_fr: 'Géorgie du Sud-et-les- Iles Sandwich du Sud' },
  { code: 'GT', name_en: 'Guatemala', name_fr: 'Guatemala' },
  { code: 'GU', name_en: 'Guam', name_fr: 'Guam' },
  { code: 'GW', name_en: 'Guinea-Bissau', name_fr: 'Guinée-Bissau' },
  { code: 'GY', name_en: 'Guyana', name_fr: 'Guyana' },
  { code: 'HK', name_en: 'Hong Kong', name_fr: 'Hong Kong' },
  { code: 'HM', name_en: 'Heard Island and McDonald Islands', name_fr: 'Iles Heard-et-McDonald' },
  { code: 'HN', name_en: 'Honduras', name_fr: 'Honduras' },
  { code: 'HR', name_en: 'Croatia', name_fr: 'Croatie' },
  { code: 'HT', name_en: 'Haiti', name_fr: 'Haïti' },
  { code: 'HU', name_en: 'Hungary', name_fr: 'Hongrie' },
  { code: 'ID', name_en: 'Indonesia', name_fr: 'Indonésie' },
  { code: 'IE', name_en: 'Ireland', name_fr: 'Irlande' },
  { code: 'IL', name_en: 'Israel', name_fr: 'Israël' },
  { code: 'IM', name_en: 'Isle of Man', name_fr: 'Ile de Man' },
  { code: 'IN', name_en: 'India', name_fr: 'Inde' },
  { code: 'IO', name_en: 'British Indian Ocean Territory', name_fr: 'Océan Indien, territoire britannique de l\'' },
  { code: 'IQ', name_en: 'Iraq', name_fr: 'Iraq' },
  { code: 'IR', name_en: 'Iran (Islamic Republic of)', name_fr: 'Iran (République islamique d\')' },
  { code: 'IS', name_en: 'Iceland', name_fr: 'Islande' },
  { code: 'IT', name_en: 'Italy', name_fr: 'Italie' },
  { code: 'JE', name_en: 'Jersey', name_fr: 'Jersey' },
  { code: 'JM', name_en: 'Jamaica', name_fr: 'Jamaïque' },
  { code: 'JO', name_en: 'Jordan', name_fr: 'Jordanie' },
  { code: 'JP', name_en: 'Japan', name_fr: 'Japon' },
  { code: 'KE', name_en: 'Kenya', name_fr: 'Kenya' },
  { code: 'KG', name_en: 'Kyrgyzstan', name_fr: 'Kirghizistan' },
  { code: 'KH', name_en: 'Cambodia', name_fr: 'Cambodge' },
  { code: 'KI', name_en: 'Kiribati', name_fr: 'Kiribati' },
  { code: 'KM', name_en: 'Comoros', name_fr: 'Comores' },
  { code: 'KN', name_en: 'Saint Kitts and Nevis', name_fr: 'Saint-Kitts-et-Nevis' },
  { code: 'KP', name_en: 'Korea, Democratic People\'s Republic of', name_fr: 'Corée, République populaire démocratique de' },
  { code: 'KR', name_en: 'Korea, Republic of', name_fr: 'Corée, République de' },
  { code: 'KW', name_en: 'Kuwait', name_fr: 'Koweït' },
  { code: 'KY', name_en: 'Cayman Islands', name_fr: 'Caïmans, Iles' },
  { code: 'KZ', name_en: 'Kazakhstan', name_fr: 'Kazakhstan' },
  { code: 'LA', name_en: 'Lao People\'s Democratic Republic', name_fr: 'Lao, République démocratique populaire' },
  { code: 'LB', name_en: 'Lebanon', name_fr: 'Liban' },
  { code: 'LC', name_en: 'Saint Lucia', name_fr: 'Sainte-Lucie' },
  { code: 'LI', name_en: 'Liechtenstein', name_fr: 'Liechtenstein' },
  { code: 'LK', name_en: 'Sri Lanka', name_fr: 'Sri Lanka' },
  { code: 'LR', name_en: 'Liberia', name_fr: 'Liberia' },
  { code: 'LS', name_en: 'Lesotho', name_fr: 'Lesotho' },
  { code: 'LT', name_en: 'Lithuania', name_fr: 'Lituanie' },
  { code: 'LU', name_en: 'Luxembourg', name_fr: 'Luxembourg' },
  { code: 'LV', name_en: 'Latvia', name_fr: 'Lettonie' },
  { code: 'LY', name_en: 'Libya', name_fr: 'Libye' },
  { code: 'MA', name_en: 'Morocco', name_fr: 'Maroc' },
  { code: 'MC', name_en: 'Monaco', name_fr: 'Monaco' },
  { code: 'MD', name_en: 'Moldova, Republic of', name_fr: 'Moldova, République de' },
  { code: 'ME', name_en: 'Montenegro', name_fr: 'Monténégro' },
  { code: 'MF', name_en: 'Saint Martin', name_fr: 'Saint-Martin' },
  { code: 'MG', name_en: 'Madagascar', name_fr: 'Madagascar' },
  { code: 'MH', name_en: 'Marshall Islands', name_fr: 'Marshall, Iles' },
  { code: 'MK', name_en: 'Macedonia, Former Yugoslav Republic of', name_fr: 'Macédoine, L\'ex-république yougoslave de' },
  { code: 'ML', name_en: 'Mali', name_fr: 'Mali' },
  { code: 'MM', name_en: 'Myanmar', name_fr: 'Myanmar' },
  { code: 'MN', name_en: 'Mongolia', name_fr: 'Mongolie' },
  { code: 'MO', name_en: 'Macao', name_fr: 'Macao' },
  { code: 'MP', name_en: 'Northern Mariana islands', name_fr: 'Mariannes du Nord, Iles' },
  { code: 'MQ', name_en: 'Martinique', name_fr: 'Martinique' },
  { code: 'MR', name_en: 'Mauritania', name_fr: 'Mauritanie' },
  { code: 'MS', name_en: 'Montserrat', name_fr: 'Montserrat' },
  { code: 'MT', name_en: 'Malta', name_fr: 'Malte' },
  { code: 'MU', name_en: 'Mauritius', name_fr: 'Maurice, Ile' },
  { code: 'MV', name_en: 'Maldives', name_fr: 'Maldives' },
  { code: 'MW', name_en: 'Malawi', name_fr: 'Malawi' },
  { code: 'MX', name_en: 'Mexico', name_fr: 'Mexique' },
  { code: 'MY', name_en: 'Malaysia', name_fr: 'Malaisie' },
  { code: 'MZ', name_en: 'Mozambique', name_fr: 'Mozambique' },
  { code: 'NA', name_en: 'Namibia', name_fr: 'Namibie' },
  { code: 'NC', name_en: 'New Caledonia', name_fr: 'Nouvelle-Calédonie' },
  { code: 'NE', name_en: 'Niger', name_fr: 'Niger' },
  { code: 'NF', name_en: 'Norfolk Island', name_fr: 'Norfolk, Ile' },
  { code: 'NG', name_en: 'Nigeria', name_fr: 'Nigéria' },
  { code: 'NI', name_en: 'Nicaragua', name_fr: 'Nicaragua' },
  { code: 'NL', name_en: 'Netherlands', name_fr: 'Pays-Bas' },
  { code: 'NO', name_en: 'Norway', name_fr: 'Norvège' },
  { code: 'NP', name_en: 'Nepal', name_fr: 'Népal' },
  { code: 'NR', name_en: 'Nauru', name_fr: 'Nauru' },
  { code: 'NT', name_en: 'Neutral zone', name_fr: 'Zone neutre' },
  { code: 'NU', name_en: 'Niue', name_fr: 'Niue' },
  { code: 'NZ', name_en: 'New Zealand', name_fr: 'Nouvelle-Zélande' },
  { code: 'OM', name_en: 'Oman', name_fr: 'Oman' },
  { code: 'PA', name_en: 'Panama', name_fr: 'Panama' },
  { code: 'PE', name_en: 'Peru', name_fr: 'Pérou' },
  { code: 'PF', name_en: 'French Polynesia', name_fr: 'Polynésie française' },
  { code: 'PG', name_en: 'Papua New Guinea', name_fr: 'Papouasie-Nouvelle-Guinée' },
  { code: 'PH', name_en: 'Philippines', name_fr: 'Philippines' },
  { code: 'PK', name_en: 'Pakistan', name_fr: 'Pakistan' },
  { code: 'PL', name_en: 'Poland', name_fr: 'Pologne' },
  { code: 'PM', name_en: 'St. Pierre and Miquelon', name_fr: 'Saint-Pierre-et-Miquelon' },
  { code: 'PN', name_en: 'Pitcairn', name_fr: 'Pitcairn' },
  { code: 'PR', name_en: 'Puerto Rico', name_fr: 'Porto Rico' },
  { code: 'PS', name_en: 'Palestinian Territory, Occupied', name_fr: 'Palestinien occupé, Territoire' },
  { code: 'PT', name_en: 'Portugal', name_fr: 'Portugal' },
  { code: 'PW', name_en: 'Palau', name_fr: 'Palau' },
  { code: 'PY', name_en: 'Paraguay', name_fr: 'Paraguay' },
  { code: 'QA', name_en: 'Qatar', name_fr: 'Qatar' },
  { code: 'QM', name_en: 'Other Country – Central/South America', name_fr: 'Autre pays – Amérique centrale/du Sud' },
  { code: 'QN', name_en: 'Other Country – North America', name_fr: 'Autre pays – Amérique du Nord' },
  { code: 'QO', name_en: 'Other Country – Middle East', name_fr: 'Autre pays – Moyen Orient' },
  { code: 'QP', name_en: 'Other Country – Europe', name_fr: 'Autre pays – Europe' },
  { code: 'QR', name_en: 'Other Country – Asia and Oceania', name_fr: 'Autre pays – Asie et Océanie' },
  { code: 'QS', name_en: 'Other Country – Africa', name_fr: 'Autre pays – Afrique' },
  { code: 'QZ', name_en: 'Other unknown countries', name_fr: 'Autres pays inconnus' },
  { code: 'RE', name_en: 'Reunion', name_fr: 'Réunion' },
  { code: 'RO', name_en: 'Romania', name_fr: 'Roumanie' },
  { code: 'RS', name_en: 'Serbia', name_fr: 'Serbie' },
  { code: 'RU', name_en: 'Russian Federation', name_fr: 'Russie, Fédération de' },
  { code: 'RW', name_en: 'Rwanda', name_fr: 'Rwanda' },
  { code: 'SA', name_en: 'Saudi Arabia', name_fr: 'Arabie saoudite' },
  { code: 'SB', name_en: 'Solomon Islands', name_fr: 'Salomon, Iles' },
  { code: 'SC', name_en: 'Seychelles', name_fr: 'Seychelles' },
  { code: 'SD', name_en: 'Sudan', name_fr: 'Soudan' },
  { code: 'SE', name_en: 'Sweden', name_fr: 'Suède' },
  { code: 'SG', name_en: 'Singapore', name_fr: 'Singapour' },
  { code: 'SH', name_en: 'Saint Helena', name_fr: 'Sainte-Hélène' },
  { code: 'SI', name_en: 'Slovenia', name_fr: 'Slovénie' },
  { code: 'SJ', name_en: 'Svalbard and Jan Mayen', name_fr: 'Svalbard et ile Jan Mayen' },
  { code: 'SK', name_en: 'Slovakia', name_fr: 'Slovaquie' },
  { code: 'SL', name_en: 'Sierra Leone', name_fr: 'Sierra Leone' },
  { code: 'SM', name_en: 'San Marino', name_fr: 'Saint-Marin' },
  { code: 'SN', name_en: 'Senegal', name_fr: 'Sénégal' },
  { code: 'SO', name_en: 'Somalia', name_fr: 'Somalie' },
  { code: 'SR', name_en: 'Suriname', name_fr: 'Suriname' },
  { code: 'SS', name_en: 'South Sudan', name_fr: 'Soudan du Sud' },
  { code: 'ST', name_en: 'Sao Tome and Principe', name_fr: 'Sao Tomé-et-Principe' },
  { code: 'SU', name_en: 'Ussr', name_fr: 'Urss' },
  { code: 'SV', name_en: 'El Salvador', name_fr: 'El Salvador' },
  { code: 'SX', name_en: 'Sint Maarten (Dutch Part)', name_fr: 'Saint-Martin (Partie Néerlandaise)' },
  { code: 'SY', name_en: 'Syrian Arab Republic', name_fr: 'Syrienne, République arabe' },
  { code: 'SZ', name_en: 'Swaziland', name_fr: 'Swaziland' },
  { code: 'TC', name_en: 'Turks and Caicos Islands', name_fr: 'Turks et Caïques, Iles' },
  { code: 'TD', name_en: 'Chad', name_fr: 'Tchad' },
  { code: 'TF', name_en: 'French Southern Territories', name_fr: 'Terres australes françaises' },
  { code: 'TG', name_en: 'Togo', name_fr: 'Togo' },
  { code: 'TH', name_en: 'Thailand', name_fr: 'Thaïlande' },
  { code: 'TJ', name_en: 'Tajikistan', name_fr: 'Tadjikistan' },
  { code: 'TK', name_en: 'Tokelau', name_fr: 'Tokelau' },
  { code: 'TL', name_en: 'Timor-Leste', name_fr: 'Timor-Leste' },
  { code: 'TM', name_en: 'Turkmenistan', name_fr: 'Turkménistan' },
  { code: 'TN', name_en: 'Tunisia', name_fr: 'Tunisie' },
  { code: 'TO', name_en: 'Tonga', name_fr: 'Tonga' },
  { code: 'TP', name_en: 'East Timor', name_fr: 'Timor oriental' },
  { code: 'TR', name_en: 'Turkey', name_fr: 'Turquie' },
  { code: 'TT', name_en: 'Trinidad and Tobago', name_fr: 'Trinité-et-Tobago' },
  { code: 'TV', name_en: 'Tuvalu', name_fr: 'Tuvalu' },
  { code: 'TW', name_en: 'Taiwan', name_fr: 'Taiwan' },
  { code: 'TZ', name_en: 'Tanzania, United Republic of', name_fr: 'Tanzanie, République unie de' },
  { code: 'UA', name_en: 'Ukraine', name_fr: 'Ukraine' },
  { code: 'UG', name_en: 'Uganda', name_fr: 'Ouganda' },
  { code: 'UM', name_en: 'United States Minor Islands', name_fr: 'Iles mineures éloignées des États-Unis' },
  { code: 'US', name_en: 'United States', name_fr: 'États-Unis' },
  { code: 'UY', name_en: 'Uruguay', name_fr: 'Uruguay' },
  { code: 'UZ', name_en: 'Uzbekistan', name_fr: 'Ouzbékistan' },
  { code: 'VA', name_en: 'Holy See (Vatican City State)', name_fr: 'Vatican, État' },
  { code: 'VC', name_en: 'Saint Vincent and the Grenadines', name_fr: 'Saint-Vincent-et-les-Grenadines' },
  { code: 'VE', name_en: 'Venezuela', name_fr: 'Venezuela' },
  { code: 'VG', name_en: 'Virgin Islands (British)', name_fr: 'Iles vierges (britanniques)' },
  { code: 'VI', name_en: 'Virgin Islands (United States)', name_fr: 'Iles vierges (États-Unis)' },
  { code: 'VN', name_en: 'Vietnam', name_fr: 'Vietnam' },
  { code: 'VU', name_en: 'Vanuatu', name_fr: 'Vanuatu' },
  { code: 'WF', name_en: 'Wallis and Futuna', name_fr: 'Wallis-et-Futuna' },
  { code: 'WS', name_en: 'Samoa', name_fr: 'Samoa' },
  { code: 'XZ', name_en: 'Kosovo', name_fr: 'Kosovo' },
  { code: 'YE', name_en: 'Yemen', name_fr: 'Yémen' },
  { code: 'YT', name_en: 'Mayotte', name_fr: 'Mayotte' },
  { code: 'YU', name_en: 'Yugoslavia', name_fr: 'Yougoslavie' },
  { code: 'ZA', name_en: 'South Africa', name_fr: 'Afrique du sud' },
  { code: 'ZM', name_en: 'Zambia', name_fr: 'Zambie' },
  { code: 'ZR', name_en: 'Zaire', name_fr: 'Zaïre' },
  { code: 'ZW', name_en: 'Zimbabwe', name_fr: 'Zimbabwe' },
]

// ─── Provinces / States ─────────────────────────────────────────────────────
const PROVINCES_STATES = [
  { code: 'AB', name_en: 'Alberta', name_fr: 'Alberta', country: 'US' },
  { code: 'BC', name_en: 'British Columbia', name_fr: 'Colombie-Britannique', country: 'US' },
  { code: 'MB', name_en: 'Manitoba', name_fr: 'Manitoba', country: 'US' },
  { code: 'NB', name_en: 'New Brunswick', name_fr: 'Nouveau-Brunswick', country: 'US' },
  { code: 'NF', name_en: 'Newfoundland', name_fr: 'Terre-Neuve', country: 'US' },
  { code: 'NL', name_en: 'Newfoundland and Labrador', name_fr: 'Terre-Neuve-et-Labrador', country: 'US' },
  { code: 'NS', name_en: 'Nova Scotia', name_fr: 'Nouvelle-Écosse', country: 'US' },
  { code: 'NT', name_en: 'Northwest Territories', name_fr: 'Territoires du Nord-Ouest', country: 'US' },
  { code: 'NU', name_en: 'Nunavut', name_fr: 'Nunavut', country: 'US' },
  { code: 'ON', name_en: 'Ontario', name_fr: 'Ontario', country: 'US' },
  { code: 'PE', name_en: 'Prince Edward Island (PEI)', name_fr: 'Île-du-Prince-Édouard (I.P.E)', country: 'US' },
  { code: 'QC', name_en: 'Quebec', name_fr: 'Québec', country: 'US' },
  { code: 'SK', name_en: 'Saskatchewan', name_fr: 'Saskatchewan', country: 'US' },
  { code: 'YT', name_en: 'Yukon', name_fr: 'Yukon', country: 'US' },
  { code: 'AK', name_en: 'Alaska', name_fr: 'Alaska', country: 'US' },
  { code: 'AL', name_en: 'Alabama', name_fr: 'Alabama', country: 'US' },
  { code: 'AR', name_en: 'Arkansas', name_fr: 'Arkansas', country: 'US' },
  { code: 'AS', name_en: 'American Samoa', name_fr: 'Samoa américaines', country: 'US' },
  { code: 'AZ', name_en: 'Arizona', name_fr: 'Arizona', country: 'US' },
  { code: 'CA', name_en: 'California', name_fr: 'Californie', country: 'US' },
  { code: 'CO', name_en: 'Colorado', name_fr: 'Colorado', country: 'US' },
  { code: 'CT', name_en: 'Connecticut', name_fr: 'Connecticut', country: 'US' },
  { code: 'DC', name_en: 'District of Columbia', name_fr: 'District de Columbia', country: 'US' },
  { code: 'DE', name_en: 'Delaware', name_fr: 'Delaware', country: 'US' },
  { code: 'FL', name_en: 'Florida', name_fr: 'Floride', country: 'US' },
  { code: 'FM', name_en: 'Federated States of Micronesia', name_fr: 'État fédéral de Micronésie', country: 'US' },
  { code: 'GA', name_en: 'Georgia', name_fr: 'Géorgie', country: 'US' },
  { code: 'GU', name_en: 'Guam', name_fr: 'Guam', country: 'US' },
  { code: 'HI', name_en: 'Hawaii', name_fr: 'Hawaï', country: 'US' },
  { code: 'IA', name_en: 'Iowa', name_fr: 'Iowa', country: 'US' },
  { code: 'ID', name_en: 'Idaho', name_fr: 'Idaho', country: 'US' },
  { code: 'IL', name_en: 'Illinois', name_fr: 'Illinois', country: 'US' },
  { code: 'IN', name_en: 'Indiana', name_fr: 'Indiana', country: 'US' },
  { code: 'KS', name_en: 'Kansas', name_fr: 'Kansas', country: 'US' },
  { code: 'KY', name_en: 'Kentucky', name_fr: 'Kentucky', country: 'US' },
  { code: 'LA', name_en: 'Louisiana', name_fr: 'Louisiane', country: 'US' },
  { code: 'MA', name_en: 'Massachusetts', name_fr: 'Massachusetts', country: 'US' },
  { code: 'MD', name_en: 'Maryland', name_fr: 'Maryland', country: 'US' },
  { code: 'ME', name_en: 'Maine', name_fr: 'Maine', country: 'US' },
  { code: 'MH', name_en: 'Marshall Islands', name_fr: 'Iles Marshall', country: 'US' },
  { code: 'MI', name_en: 'Michigan', name_fr: 'Michigan', country: 'US' },
  { code: 'MN', name_en: 'Minnesota', name_fr: 'Minnesota', country: 'US' },
  { code: 'MO', name_en: 'Missouri', name_fr: 'Missouri', country: 'US' },
  { code: 'MP', name_en: 'Northern Mariana Islands', name_fr: 'Iles Mariannes du Nord', country: 'US' },
  { code: 'MS', name_en: 'Mississippi', name_fr: 'Mississippi', country: 'US' },
  { code: 'MT', name_en: 'Montana', name_fr: 'Montana', country: 'US' },
  { code: 'NC', name_en: 'North Carolina', name_fr: 'Caroline du Nord', country: 'US' },
  { code: 'ND', name_en: 'North Dakota', name_fr: 'Dakota du Nord', country: 'US' },
  { code: 'NE', name_en: 'Nebraska', name_fr: 'Nebraska', country: 'US' },
  { code: 'NH', name_en: 'New Hampshire', name_fr: 'New Hampshire', country: 'US' },
  { code: 'NJ', name_en: 'New Jersey', name_fr: 'New Jersey', country: 'US' },
  { code: 'NM', name_en: 'New Mexico', name_fr: 'Nouveau-Mexique', country: 'US' },
  { code: 'NV', name_en: 'Nevada', name_fr: 'Nevada', country: 'US' },
  { code: 'NY', name_en: 'New York', name_fr: 'New York', country: 'US' },
  { code: 'OH', name_en: 'Ohio', name_fr: 'Ohio', country: 'US' },
  { code: 'OK', name_en: 'Oklahoma', name_fr: 'Oklahoma', country: 'US' },
  { code: 'OR', name_en: 'Oregon', name_fr: 'Oregon', country: 'US' },
  { code: 'PA', name_en: 'Pennsylvania', name_fr: 'Pennsylvanie', country: 'US' },
  { code: 'PR', name_en: 'Puerto Rico', name_fr: 'Porto Rico', country: 'US' },
  { code: 'PW', name_en: 'Palau', name_fr: 'Palau', country: 'US' },
  { code: 'RI', name_en: 'Rhode Island', name_fr: 'Rhode Island', country: 'US' },
  { code: 'SC', name_en: 'South Carolina', name_fr: 'Caroline du Sud', country: 'US' },
  { code: 'SD', name_en: 'South Dakota', name_fr: 'Dakota du Sud', country: 'US' },
  { code: 'TN', name_en: 'Tennessee', name_fr: 'Tennessee', country: 'US' },
  { code: 'TX', name_en: 'Texas', name_fr: 'Texas', country: 'US' },
  { code: 'UT', name_en: 'Utah', name_fr: 'Utah', country: 'US' },
  { code: 'VA', name_en: 'Virginia', name_fr: 'Virginie', country: 'US' },
  { code: 'VI', name_en: 'Virgin Islands', name_fr: 'Iles vierges', country: 'US' },
  { code: 'VT', name_en: 'Vermont', name_fr: 'Vermont', country: 'US' },
  { code: 'WA', name_en: 'Washington', name_fr: 'Washington', country: 'US' },
  { code: 'WI', name_en: 'Wisconsin', name_fr: 'Wisconsin', country: 'US' },
  { code: 'WV', name_en: 'West Virginia', name_fr: 'Virginie-Occidentale', country: 'US' },
  { code: 'WY', name_en: 'Wyoming', name_fr: 'Wyoming', country: 'US' },
];

// ─── Main seed function ─────────────────────────────────────────────────────

async function seed() {
  const client = await db.getClient();

  try {
    log.section('CRA T3010 Lookup Table Seeding');

    // ── Categories ──────────────────────────────────────────────
    log.info(`Seeding cra_category_lookup (${CATEGORIES.length} rows)...`);
    for (const c of CATEGORIES) {
      await client.query(
        `INSERT INTO cra_category_lookup (code, name_en, name_fr)
         VALUES ($1, $2, $3)
         ON CONFLICT (code) DO UPDATE SET
           name_en = EXCLUDED.name_en,
           name_fr = EXCLUDED.name_fr`,
        [c.code, c.name_en, c.name_fr]
      );
    }
    log.info(`  Seeded ${CATEGORIES.length} categories`);

    // ── Sub-Categories ──────────────────────────────────────────
    log.info(`Seeding cra_sub_category_lookup (${SUB_CATEGORIES.length} rows)...`);
    for (const s of SUB_CATEGORIES) {
      await client.query(
        `INSERT INTO cra_sub_category_lookup (category_code, sub_category_code, name_en, name_fr)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (category_code, sub_category_code) DO UPDATE SET
           name_en = EXCLUDED.name_en,
           name_fr = EXCLUDED.name_fr`,
        [s.cat, s.sub, s.name_en, s.name_fr]
      );
    }
    log.info(`  Seeded ${SUB_CATEGORIES.length} sub-categories`);

    // ── Designations ────────────────────────────────────────────
    log.info(`Seeding cra_designation_lookup (${DESIGNATIONS.length} rows)...`);
    for (const d of DESIGNATIONS) {
      await client.query(
        `INSERT INTO cra_designation_lookup (code, name_en, name_fr, description_en)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE SET
           name_en = EXCLUDED.name_en,
           name_fr = EXCLUDED.name_fr,
           description_en = EXCLUDED.description_en`,
        [d.code, d.name_en, d.name_fr, d.desc_en]
      );
    }
    log.info(`  Seeded ${DESIGNATIONS.length} designations`);

    // ── Program Types ───────────────────────────────────────────
    log.info(`Seeding cra_program_type_lookup (${PROGRAM_TYPES.length} rows)...`);
    for (const p of PROGRAM_TYPES) {
      await client.query(
        `INSERT INTO cra_program_type_lookup (code, name_en, name_fr, description_en)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE SET
           name_en = EXCLUDED.name_en,
           name_fr = EXCLUDED.name_fr,
           description_en = EXCLUDED.description_en`,
        [p.code, p.name_en, p.name_fr, p.desc_en]
      );
    }
    log.info(`  Seeded ${PROGRAM_TYPES.length} program types`);

    // ── Countries ───────────────────────────────────────────────
    log.info(`Seeding cra_country_lookup (${COUNTRIES.length} rows)...`);
    for (const c of COUNTRIES) {
      await client.query(
        `INSERT INTO cra_country_lookup (code, name_en, name_fr)
         VALUES ($1, $2, $3)
         ON CONFLICT (code) DO UPDATE SET
           name_en = EXCLUDED.name_en,
           name_fr = EXCLUDED.name_fr`,
        [c.code, c.name_en, c.name_fr]
      );
    }
    log.info(`  Seeded ${COUNTRIES.length} countries`);

    // ── Provinces / States ──────────────────────────────────────
    log.info(`Seeding cra_province_state_lookup (${PROVINCES_STATES.length} rows)...`);
    for (const p of PROVINCES_STATES) {
      await client.query(
        `INSERT INTO cra_province_state_lookup (code, name_en, name_fr)
         VALUES ($1, $2, $3)
         ON CONFLICT (code) DO UPDATE SET
           name_en = EXCLUDED.name_en,
           name_fr = EXCLUDED.name_fr`,
        [p.code, p.name_en, p.name_fr]
      );
    }
    log.info(`  Seeded ${PROVINCES_STATES.length} provinces/states`);

    // ── Summary ─────────────────────────────────────────────────
    const total = CATEGORIES.length + SUB_CATEGORIES.length + DESIGNATIONS.length
      + PROGRAM_TYPES.length + COUNTRIES.length + PROVINCES_STATES.length;
    log.section('Seeding Complete');
    log.info(`Total rows upserted: ${total}`);
    log.info('  Categories:      ' + CATEGORIES.length);
    log.info('  Sub-categories:  ' + SUB_CATEGORIES.length);
    log.info('  Designations:    ' + DESIGNATIONS.length);
    log.info('  Program types:   ' + PROGRAM_TYPES.length);
    log.info('  Countries:       ' + COUNTRIES.length);
    log.info('  Provinces/states:' + PROVINCES_STATES.length);

  } catch (err) {
    log.error(`Seeding failed: ${err.message}`);
    throw err;
  } finally {
    client.release();
    await db.end();
  }
}

seed().catch((err) => {
  console.error('Fatal seed error:', err);
  process.exit(1);
});
