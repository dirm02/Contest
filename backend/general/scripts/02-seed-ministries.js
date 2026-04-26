/**
 * 02-seed-ministries.js - Load current Alberta ministries into general.ministries.
 *
 * Source: alberta.ca/premier-cabinet (latest cabinet appointments).
 * Ministry data is maintained directly in this file.
 *
 * Idempotent: ON CONFLICT (short_name) DO UPDATE to keep data current.
 */
const { pool } = require('../lib/db');

const albertaMinistries = [
  {
    short_name: 'AE',
    name: 'Advanced Education',
    description: 'Advanced Education',
    minister: 'Myles McDougall',
    deputy_minister: 'Shannon Marchand',
    effective_from: '2025-05-16',
    effective_to: null,
    is_active: true,
  },
  {
    short_name: 'AU',
    name: 'Affordability and Utilities',
    description: 'Affordability and Utilities',
    minister: 'Nathan Neudorf',
    deputy_minister: 'David James',
    effective_from: '2023-06-09',
    effective_to: null,
    is_active: true,
  },
  {
    short_name: 'AI',
    name: 'Agriculture and Irrigation',
    description: 'Agriculture and Irrigation',
    minister: 'RJ Sigurdson',
    deputy_minister: 'Jason Hale',
    effective_from: '2023-06-09',
    effective_to: null,
    is_active: true,
  },
  {
    short_name: 'ACSW',
    name: 'Arts, Culture and Status of Women',
    description: 'Arts, Culture and Status of Women',
    minister: 'Tanya Fir',
    deputy_minister: 'Kim Capstick',
    effective_from: '2023-06-09',
    effective_to: null,
    is_active: true,
  },
  {
    short_name: 'ALSS',
    name: 'Assisted Living and Social Services',
    description: 'Assisted Living and Social Services',
    minister: 'Jason Nixon',
    deputy_minister: 'Dennis Cooley',
    effective_from: '2025-05-16',
    effective_to: null,
    is_active: true,
  },
  {
    short_name: 'CFS',
    name: 'Children and Family Services',
    description: 'Children and Family Services',
    minister: 'Searle Turton',
    deputy_minister: 'Lisa Sadownik',
    effective_from: '2023-06-09',
    effective_to: null,
    is_active: true,
  },
  {
    short_name: 'CPE',
    name: 'Communications and Public Engagement',
    description: 'Government communications function (no dedicated minister)',
    minister: null,
    deputy_minister: 'Enyinnah Okere',
    effective_from: null,
    effective_to: null,
    is_active: true,
  },
  {
    short_name: 'EDC',
    name: 'Education and Childcare',
    description: 'Education and Childcare',
    minister: 'Demetrios Nicolaides',
    deputy_minister: 'Lora Pillipow',
    effective_from: '2025-05-16',
    effective_to: null,
    is_active: true,
  },
  {
    short_name: 'EM',
    name: 'Energy and Minerals',
    description: 'Energy and Minerals',
    minister: 'Brian Jean',
    deputy_minister: 'Larry Kaumeyer',
    effective_from: '2023-06-09',
    effective_to: null,
    is_active: true,
  },
  {
    short_name: 'EPA',
    name: 'Environment and Protected Areas',
    description: 'Environment and Protected Areas',
    minister: 'Grant Hunter',
    deputy_minister: 'Stephanie Clarke',
    effective_from: '2023-06-09',
    effective_to: null,
    is_active: true,
  },
  {
    short_name: 'EC',
    name: 'Executive Council',
    description: "Premier's office and cabinet secretariat",
    minister: 'Danielle Smith',
    deputy_minister: 'Dale Mcfee',
    effective_from: '2022-10-11',
    effective_to: null,
    is_active: true,
  },
  {
    short_name: 'FP',
    name: 'Forestry and Parks',
    description: 'Forestry and Parks',
    minister: 'Todd Loewen',
    deputy_minister: 'Ronda Goulden',
    effective_from: '2023-06-09',
    effective_to: null,
    is_active: true,
  },
  {
    short_name: 'HSHS',
    name: 'Hospital and Surgical Health Services',
    description: 'Hospital and Surgical Health Services',
    minister: 'Matt Jones',
    deputy_minister: 'Bryce Stewart',
    effective_from: '2025-05-16',
    effective_to: null,
    is_active: true,
  },
  {
    short_name: 'IR',
    name: 'Indigenous Relations',
    description: 'Indigenous Relations',
    minister: 'Rajan Sawhney',
    deputy_minister: 'Donavon Young',
    effective_from: '2025-05-16',
    effective_to: null,
    is_active: true,
  },
  {
    short_name: 'INFRA',
    name: 'Infrastructure',
    description: 'Infrastructure',
    minister: 'Martin Long',
    deputy_minister: 'Mark Kleefeld',
    effective_from: '2025-02-27',
    effective_to: null,
    is_active: true,
  },
  {
    short_name: 'JETI',
    name: 'Jobs, Economy, Trade, and Immigration',
    description: 'Jobs, Economy, Trade, and Immigration',
    minister: 'Joseph Schow',
    deputy_minister: 'Christopher McPherson',
    effective_from: '2025-05-16',
    effective_to: null,
    is_active: true,
  },
  {
    short_name: 'JUS',
    name: 'Justice',
    description: 'Justice and Solicitor General',
    minister: 'Mickey Amery',
    deputy_minister: 'Malcolm Lavoie, KC',
    effective_from: '2023-06-09',
    effective_to: null,
    is_active: true,
  },
  {
    short_name: 'MHA',
    name: 'Mental Health and Addiction',
    description: 'Mental Health and Addiction',
    minister: 'Rick Wilson',
    deputy_minister: 'Evan Romanow',
    effective_from: '2025-05-16',
    effective_to: null,
    is_active: true,
  },
  {
    short_name: 'MA',
    name: 'Municipal Affairs',
    description: 'Municipal Affairs',
    minister: 'Dan Williams',
    deputy_minister: 'Jonah Mozeson',
    effective_from: '2025-05-16',
    effective_to: null,
    is_active: true,
  },
  {
    short_name: 'PPHS',
    name: 'Primary and Preventative Health Services',
    description: 'Primary and Preventative Health Services',
    minister: 'Adriana LaGrange',
    deputy_minister: 'Matt Torigian',
    effective_from: '2025-05-16',
    effective_to: null,
    is_active: true,
  },
  {
    short_name: 'PSES',
    name: 'Public Safety and Emergency Services',
    description: 'Public Safety and Emergency Services',
    minister: 'Mike Ellis',
    deputy_minister: 'Justin Krikler',
    effective_from: '2023-06-09',
    effective_to: null,
    is_active: true,
  },
  {
    short_name: 'PSC',
    name: 'Public Service Commission',
    description: 'Civil service HR and management body (no dedicated minister)',
    minister: null,
    deputy_minister: 'Heather Caltagirone',
    effective_from: null,
    effective_to: null,
    is_active: true,
  },
  {
    short_name: 'SARTR',
    name: 'Service Alberta and Red Tape Reduction',
    description: 'Service Alberta and Red Tape Reduction',
    minister: 'Dale Nally',
    deputy_minister: 'Brandy Cox',
    effective_from: '2022-10-24',
    effective_to: null,
    is_active: true,
  },
  {
    short_name: 'TI',
    name: 'Technology and Innovation',
    description: 'Technology and Innovation',
    minister: 'Nate Glubish',
    deputy_minister: 'Janak Alford',
    effective_from: '2022-10-24',
    effective_to: null,
    is_active: true,
  },
  {
    short_name: 'TS',
    name: 'Tourism and Sport',
    description: 'Tourism and Sport',
    minister: 'Andrew Boitchenko',
    deputy_minister: 'David Goldstein',
    effective_from: '2025-05-16',
    effective_to: null,
    is_active: true,
  },
  {
    short_name: 'TEC',
    name: 'Transportation and Economic Corridors',
    description: 'Transportation and Economic Corridors',
    minister: 'Devin Dreeshen',
    deputy_minister: 'Paul Smith',
    effective_from: '2022-10-24',
    effective_to: null,
    is_active: true,
  },
  {
    short_name: 'TBF',
    name: 'Treasury Board and Finance',
    description: 'Treasury Board and Finance',
    minister: 'Nate Horner',
    deputy_minister: 'Katherine White',
    effective_from: '2023-06-09',
    effective_to: null,
    is_active: true,
  },
];

async function run() {
  const client = await pool.connect();
  try {
    console.log(`Seeding ${albertaMinistries.length} Alberta ministries...`);

    let upserted = 0;
    for (const m of albertaMinistries) {
      await client.query(
        `INSERT INTO general.ministries
           (short_name, name, description, minister, deputy_minister,
            effective_from, effective_to, is_active, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (short_name) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           minister = EXCLUDED.minister,
           deputy_minister = EXCLUDED.deputy_minister,
           effective_from = EXCLUDED.effective_from,
           effective_to = EXCLUDED.effective_to,
           is_active = EXCLUDED.is_active,
           updated_at = NOW()`,
        [
          m.short_name, m.name, m.description, m.minister,
          m.deputy_minister, m.effective_from, m.effective_to, m.is_active,
        ]
      );
      upserted++;
    }

    console.log(`  Upserted ${upserted} ministries.`);

    // Verify
    const result = await client.query(
      'SELECT short_name, name, minister FROM general.ministries ORDER BY name'
    );
    console.log(`\nCurrent ministries (${result.rows.length}):`);
    for (const r of result.rows) {
      const minister = r.minister ? r.minister : '(no minister)';
      console.log(`  ${r.short_name.padEnd(6)} ${r.name.padEnd(50)} ${minister}`);
    }
  } catch (err) {
    console.error('Seed error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
