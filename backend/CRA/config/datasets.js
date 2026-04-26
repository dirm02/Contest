/**
 * CRA T3010 Dataset Inventory - Government of Canada Open Data Portal
 *
 * Reads from dataset-inventory.json (the single source of truth for UUIDs).
 * To add a new fiscal year, edit dataset-inventory.json and add the UUID.
 *
 * API: https://open.canada.ca/data/en/api/3/action/datastore_search?resource_id=<UUID>
 */
const path = require('path');
const inventory = require('./dataset-inventory.json');

// Fiscal years that have API UUIDs (excludes 2024 which is CSV-only)
const FISCAL_YEARS = inventory.fiscalYears.filter(y => {
  // A year is API-fetchable if at least one dataset has a UUID for it
  return Object.values(inventory.datasets).some(ds => ds.uuids && ds.uuids[y]);
});

// Build DATASETS object from JSON (matching the shape used by fetch/import scripts)
const DATASETS = {};
for (const [key, ds] of Object.entries(inventory.datasets)) {
  DATASETS[key] = {
    id: ds.id,
    name: ds.name,
    table: ds.table,
    description: ds.description,
    uuids: ds.uuids || {},
  };
}

/**
 * Get the UUID for a specific dataset and fiscal year.
 * Returns null if the dataset is not available for that year.
 */
function getResourceId(datasetKey, year) {
  const dataset = DATASETS[datasetKey];
  if (!dataset) return null;
  return dataset.uuids[year] || null;
}

/**
 * Get all datasets that have API data available for a given fiscal year.
 */
function getDatasetsForYear(year) {
  const result = [];
  for (const [key, dataset] of Object.entries(DATASETS)) {
    if (dataset.uuids[year]) {
      result.push({ key, ...dataset, resourceId: dataset.uuids[year] });
    }
  }
  return result;
}

/**
 * Get all years that have API data for a given dataset.
 */
function getYearsForDataset(datasetKey) {
  const dataset = DATASETS[datasetKey];
  if (!dataset) return [];
  return Object.keys(dataset.uuids).map(Number).sort();
}

/**
 * Get a flat list of all (datasetKey, year, uuid) combinations.
 */
function getAllDatasetYearCombinations() {
  const combinations = [];
  for (const [key, dataset] of Object.entries(DATASETS)) {
    for (const [year, uuid] of Object.entries(dataset.uuids)) {
      combinations.push({
        datasetKey: key,
        year: Number(year),
        uuid,
        name: dataset.name,
        table: dataset.table,
      });
    }
  }
  return combinations.sort((a, b) => a.year - b.year || a.id - b.id);
}

/**
 * Get the full inventory (including CSV paths for 2024).
 * Used by 2024-specific scripts.
 */
function getInventory() {
  return inventory;
}

module.exports = {
  FISCAL_YEARS,
  DATASETS,
  getResourceId,
  getDatasetsForYear,
  getYearsForDataset,
  getAllDatasetYearCombinations,
  getInventory,
};
