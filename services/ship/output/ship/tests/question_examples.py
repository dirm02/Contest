"""Question examples used for router and end-to-end smoke coverage."""

QUESTIONS_BY_RECIPE = {
    "funding_loops": [
        "What loops exist between Alberta charities?",
        "Show me the largest charity funding cycles.",
        "Which CRA qualified-donee gift loops move the most money?",
        "Find suspicious circular funding among charities.",
        "Are there circular gift flows above $100,000?",
    ],
    "zombie_recipients": [
        "Which charities had government funding above 70% of revenue and stopped filing?",
        "Find government-funded charities with stale CRA filings.",
        "Who received large public funding and has not filed recently?",
        "Show charities with high government revenue share before 2024.",
        "Which recipients look inactive after public funding?",
    ],
    "ghost_capacity": [
        "Which charities have high overhead but no staff?",
        "Find organizations with broad overhead over 70% and zero compensated staff.",
        "Show ghost-capacity charities with high administration spending.",
        "Which charities report no staff but high expenditures?",
        "Find overhead outliers with no compensated employees.",
    ],
    "duplicative_funding": [
        "Which organizations receive both federal and Alberta funding?",
        "Show recipients funded from multiple public datasets.",
        "Find entities with federal grants and Alberta grants.",
        "Which canonical recipients have several funding source families?",
        "Where does public funding overlap across datasets?",
    ],
    "vendor_concentration": [
        "How concentrated is health spending in Alberta?",
        "Which vendors dominate sole-source contracts?",
        "Show vendor concentration for Alberta public spending.",
        "Which ministries have the highest supplier concentration?",
        "Find high HHI public-spending segments.",
    ],
    "sole_source_amendment": [
        "Show me the largest sole-source contracts in 2024.",
        "Which Alberta sole-source segments are most concentrated?",
        "How has sole-source spending trended?",
        "Find sole-source dependency by ministry.",
        "Show sole-source contract concentration and trends.",
    ],
    "contract_intelligence": [
        "What contract categories are growing fastest?",
        "Analyze Alberta contract spending trends.",
        "Which contract spending segments are concentrated?",
        "Show contract intelligence for Alberta ministries.",
        "How have public contracts changed over time?",
    ],
    "related_parties": [
        "Are there directors who sit on multiple funded charity boards?",
        "Find related-party board overlap.",
        "Which CRA directors are connected to several funded orgs?",
        "Show governance overlap across charities.",
        "Find directors associated with multiple public-funded recipients.",
    ],
    "policy_misalignment": [
        "How much climate-related grant spending is visible over time?",
        "What data is available to compare policy targets with spending?",
        "Show policy keyword spending trends.",
        "Can we measure housing spending against available fields?",
        "Audit coverage for policy-alignment analysis.",
    ],
    "adverse_media": [
        "Are large funded recipients linked to regulatory or court records?",
        "Check top funded recipients for regulator findings.",
        "Find adverse court or sanction records for public-funding recipients.",
        "Which funded entities have enforcement-source web evidence?",
        "Search official sources for adverse records tied to recipients.",
    ],
}

