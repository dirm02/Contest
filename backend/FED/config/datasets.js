/**
 * Federal Grants and Contributions Dataset Configuration
 *
 * Reads from dataset-inventory.json (the single source of truth for UUIDs).
 *
 * Unlike CRA (19 datasets × 4 years = 74 UUIDs), Federal Grants has a single
 * resource UUID containing all fiscal years and all departments.
 *
 * API: https://open.canada.ca/data/en/api/3/action/datastore_search?resource_id=<UUID>
 */
const inventory = require('./dataset-inventory.json');

const RESOURCE_ID = inventory.datasets.grants.uuid;
const DATASET_NAME = inventory.datasets.grants.name;
const TABLE_NAME = inventory.datasets.grants.table;

/**
 * Get the resource UUID for the grants dataset.
 */
function getResourceId() {
  return RESOURCE_ID;
}

/**
 * Get the full inventory metadata.
 */
function getInventory() {
  return inventory;
}

module.exports = {
  RESOURCE_ID,
  DATASET_NAME,
  TABLE_NAME,
  getResourceId,
  getInventory,
};
