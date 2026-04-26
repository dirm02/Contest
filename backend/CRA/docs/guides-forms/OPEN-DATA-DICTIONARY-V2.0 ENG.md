# open data data dictionary v2.0 eng

<!-- Page 1 -->
UNCLASSIFIED - NON CLASSIFIÉ

UNCLASSIFIED

---

**Open Data**

**List of charities
Years 2013 to 2023**
Data Dictionary

Version 2.0 &nbsp; C1/B1 October 2023 Release

**Last revised** &nbsp; 2023-08-23

---

**1 of 44**

Canada Revenue Agency &nbsp; Agence du revenu du Canada &nbsp; **Canadä**


<!-- Page 2 -->
# Table of Contents

Revision History ................................................................................................................................................................... 3

1. Introduction ..................................................................................................................................................................... 4

1.1 About this document ................................................................................................................................................. 4

1.2 Document Organization............................................................................................................................................. 5

1.3 Target Audience......................................................................................................................................................... 6

1.4 Summary of changes.................................................................................................................................................. 6

2. Relationship Diagram..................................................................................................................................................... 12

3. Datasets ......................................................................................................................................................................... 13

3.1 Identification............................................................................................................................................................ 13

3.2 Charity Contact Web Addresses .............................................................................................................................. 14

3.3 Charities Businesses Directors/Officers................................................................................................................... 15

3.4 Qualified Donees...................................................................................................................................................... 16

3.5 Charitable Programs ................................................................................................................................................ 17

3.6 General Information ................................................................................................................................................ 18

3.7 Financial Data........................................................................................................................................................... 23

3.8 Private/Public Foundations...................................................................................................................................... 29

3.9 Activities Outside Canada - Details on financial...................................................................................................... 30

3.10 Activities outside Canada – Countries where program was carried...................................................................... 32

3.11 Activities outside Canada –Exported goods........................................................................................................... 33

3.12 Activities Outside Canada - Financial resources used............................................................................................ 34

3.13 Compensation....................................................................................................................................................... 35

3.14 Non-cash gifts (gifts in kind) received................................................................................................................... 36

3.15 Political Activities / Public Policy and Development Activities.............................................................................. 37

3.16 Political Activities – Funding .................................................................................................................................. 38

3.17 Political Activities – Resources............................................................................................................................... 39

3.18 Grants to Non-Qualified Donees............................................................................................................................ 40

3.19 Schedule 8 Disbursement Quota ........................................................................................................................... 41

<!-- Page 3 -->
## Revision History

| **Version & Date** | **Description** | **Changed By** |
|---|---|---|
| 1.0 2022-11-21 | First version | |
| 2.0 2023-08-23 | Second Version | |

<!-- Page 4 -->
# 1. Introduction

## 1.1 About this document

The purpose of this document is to describe the public data of Form T3010 available on the Open Data website (open.canada.ca). This data dictionary covers registered charity information returns with a The month and day of the charity's fiscal year end. Charities must file their annual Form T3010 within six months of their fiscal year-end. Date that falls within the **2013 – 2023** calendar years.

To reduce the administrative burden on charities, the Canada Revenue Agency (CRA) is modernizing its information technology (IT) systems to provide new digital service options.

In May 2019, the Charities Directorate made several digital services available as part of this initiative:

- Form T2050, Application to Register a Charity under the Income Tax Act, was replaced by a new online application for registration.
- Registered charities can complete and file their T3010 Registered Charity Information Return online through CRA's My Business Account.
- Charities can update their organization's information online and correspond with the Directorate electronically through My Business Account.

### Supporting Documents

- T3010 (year in question) – *Registered Charity Information Return*
Form that registered charities must fill out annually and send to CRA within six months of the end of its fiscal period. A charity uses this form to report its activities, sources of revenue, and expenditures.

- T1235 (year in question) – *Directors/Trustees and Like Officials Worksheet* Form used by a registered charity to identify its board of directors/trustees and like officials. Every charity must submit this form as part of its annual return.

- T1236 (year in question) – *Qualified Donees Worksheet/Amounts Provided to Other Organizations*
Form used by a registered charity to identify the gifts it made to qualified donees and other organizations during a fiscal year. Every charity must submit this form as part of its annual return.

- T1441(year in question) - Qualifying disbursements: Grants to non-qualified donees (grantees)
Form used by a registered charity to identify the qualifying disbursements to non-qualified Donees during a fiscal year. Every charity must submit this form as part of its annual return.

- TF725 – *Registered Charity Basic Information Sheet (BIS)*
A pre-printed form that was mailed to registered charities in the month following their The month and day of the charity's fiscal year end. Charities must file their annual Form T3010 within six months of their fiscal year-end.as part of their T3010 information return package.

  **NOTE:** As of May 2019, the BIS is no longer mailed to charities.

- T4033 – *Completing the Registered Charity Information Return*
Guide that provides help on filling out the registered charity information return.

- Open Data *Codes Lists*

<!-- Page 5 -->
The codes lists outline all code IDs and associated descriptions identified in this document.

## 1.2 Document Organization

This document is organized into the following sections:

| **Section** | **Description** |
|-------------|-----------------|
| Introduction | Provides information related to this document |
| Relationships | Describes the relationships between each dataset |
| Datasets | Describes each data element in a dataset NOTE: The fields have been marked with a key (🔑) symbol to uniquely identify a record within the file. |

<!-- Page 6 -->
UNCLASSIFIED
Page 6 of 44
UNCLASSIFIED - NON CLASSIFIÉ

## 1.3 Target Audience

The information found in the datasets is intended for everyone interested in using data in machine-readable formats.

## 1.4 Summary of changes

The below changes reflect every T3010 form version/revision implemented since May 2019.

**T3010 Paper Revision - ID Reference Table**

| Form ID | Revision Number (English) | Revision Number (French) | Release Date |
|---------|--------------------------|--------------------------|--------------|
| 23 | T3010 E (19) Version B | T3010 F (19) Version B | May 2019 |
| 24 | T3010 E (19) Version C | T3010 F (19) Version C | October 2019 |
| 25 | T3010 E (20) Version A | T3010 F (20) Version A | May 2020 |
| 26 | T3010 E (23) Version A | T3010 F (23) Version A | May 2023 |
| 27 | T3010 E (24) Version A | T3010 F (24) Version A | October 2023 |

### 1.4.1 Changes to T3010 (19) Version B – May 2019

| **Impacted Areas** | **Details** |
|-------------------|-------------|
| Versioning Information | This was the first version of T3010 form version 23 (v23). |
| Basic Information Sheet (BIS) | As of May 2019, the BIS was no longer mailed out to charities. |
| Charity contacts | The BIS was the primary source of contact information that was submitted as part of the T3010. It was decommissioned in May 2019. Contact information is stored at the charity account level, and allows for multiple contacts, for example, a charity can now store multiple web addresses. |
| New sub-category code field ("Identification" section). | Added new sub-category code field, which is a subset of category code. There were also several category code changes; these codes can be found in the codes lists data dictionary. |
| "Activities outside Canada – Details on financial" Section | "CIDA" was changed to "Global Affairs". |
| "Non-Cash Gifts (Gifts in Kind) Received" Section | On the T3010 form the term "Gifts in kind" was renamed "Noncash gifts". |
| Codes Lists | Multiple code lists have changed |
| Financial fields | All financial fields in the extract now have a length of 14, including one digit reserved for a potential negative sign. |


<!-- Page 7 -->
UNCLASSIFIED
Page 7 of 44
UNCLASSIFIED - NON CLASSIFIÉ

## 1.4.2 Changes to T3010 (19) Version C – October 2019

| Impacted Areas | Details |
|---|---|
| New Form Version | The new form version 24 (v24) was released. Various questions were removed from the form. |
| Old Form Versions | Old versions of the form (i.e. v23) can still be entered into the system if they're received on paper, if an adjustment to the old version is being processed, or if an existing version 23 of the form was in progress at the time of the fall 2019 release. |
| New Form ID data element | A new "Form ID" key field was added to this data dictionary to indicate the form version of the T3010 that is being reported on within specific data records. It was added to each table that uniquely associates to a T3010. |
| New "Associated Form ID" column | A new "Associated Form ID" column was added to each table below to indicate which form version (by Form ID) will populate a value for that field. This column identifies the data being populated as follows: a. If the entry is blank the field will be populated for all versions. b. If there is a "Form ID" value the field will only be populated for the specified versions in that column. |
| Schedule 7 "Political Activities Funding" and "Political Activities Resources" tables removed | Two of the reported tables (**"Political Activities - Funding"** and **"Political Activities - Resources"**) were removed from version 24 of the form and the associated tables will no longer populate records for v24 and onward. This means that only the description table remained for v24 and onward. |
| Schedule 7 "Political Activities – Description" table was renamed | For version 24 of the T3010 form, Schedule 7 "Political Activities – Description" table was renamed "Public Policy and Development Activities - Description". |

## 1.4.3 Changes to T3010 (20) Version A – October 2020

| Impacted Areas | Details |
|---|---|
| New Form Version | The new form version 25 (v25) was released. |
| Schedule 7 "Public Policy and Development Activities – Description" table was removed | The "Public Policy and Development Activities – Description" table was removed from form. This means that it will only be populated for form versions prior to v25. |
| Section C – Line 2400 was removed | The associated activation question for Schedule 7 in Section C (Line 2400) was also removed from v25. |

<!-- Page 8 -->
## 1.4.4 Changes to T3010(23) Version A – May 2023

| Impacted Areas | Details |
|---|---|
| New Form Version | There is a new T3010 version (v26) being developed and deployed for May 2023 which will introduce following changes. These changes are addressed in the data dictionary modifications presented below and are the result of the legislative changes as part of the Budget 2022 - new "charitable partnerships" framework, regulation 3703 (which was enacted when Bill C-19 received Royal Assent on June 23, 2022) |
| Old Form Versions | • Old versions of the form (i.e. v23/24/25) can still be entered into the system if they are received by paper, an adjustment to the old version is being processed, or an existing version 25 of the form is in progress at the time of the May 2023 release. Going forward the CHAMP system will handle, and report on, all versions of T3010 as it is expected there will be additional T3010 form changes in future releases.<br><br>• In order to accommodate old versions of the form all fields will remain intact even if they no longer exist for the specified version of the T3010. In these cases the system will produce a blank field value for that T3010 record |
| New Form ID data element | A new "Form ID" key field was added to this data dictionary to indicate the form version of the T3010 that is being reported on within specific data records. It was added to each table that uniquely associates to a T3010. |
| New "Associated Form ID" column | A new "Associated Form ID" column was added to each table below to indicate which form version (by Form ID) will populate a value for that field.<br>This column identifies the data being populated as follows:<br>• If the entry is blank the field will be populated for all versions.<br>• If there is a "Form ID" value the field will only be populated for the specified versions in that column. |
| Section C – 4 new fields | Four new fields were added to the form and are as follows:<br>• 5840<br>• 5841<br>• 5842<br>• 5843 |
| Section D / Schedule 6 (text changes + one new field) | One new field was added to Schedule6/Section D<br>• 5045 |

<!-- Page 9 -->
UNCLASSIFIED
Page 9 of 44
UNCLASSIFIED - NON CLASSIFIÉ

| Schedule 2 Activities Outside Canada - Details on financial ( text changes) | One text description is updated <br> • 210 |
|---|---|
| New form T1441 - Qualifying disbursements: Grants to non-qualified donees (grantees). | Total number of grantees to which the charity made grants totalling more than $5000 in the fiscal period. For each grantee, the following fields are available to the user: <br> • Name of grantee <br> • Purpose of each grant <br> • Amount of Cash disbursements <br> • Amount of non-cash disbursements <br> • If outside Canada, enter the country where the activities were carried out |

## 1.4.5 Changes to T3010 (24) Version A – October 2023

| **Impacted Areas** | **Details** |
|---|---|
| New Form Version | T3010 version (v27) introduces the following changes. These changes are addressed in the data dictionary modifications presented below and are the result of the legislative changes as part of Budget 2022 - new Disbursement Quota (DQ) amendments passed into law, as Bill C-32, Fall Economic Statement Implementation Act, 2022, received Royal Assent. The changes listed below will apply to organizations filing for fiscal periods beginning on or after January 1, 2023 |
| Old Form Versions | • Old versions of the form (i.e. v23, 24,25, 26) can still be entered into the system if they are received by paper, an adjustment to the old version is being processed. The system will handle, and report on, all versions of the T3010 as it is expected there will be additional T3010 form changes in future releases <br> • In order to accommodate old versions of the form all fields will remain intact even if they no longer exist for the specified version of the T3010. In these cases the system will produce a blank field value for that T3010 record |
| Section C – New Questions C17 & C18 with 6 new Lines | **Add six new fields:** <br> • Line 5850 – In the 24 months prior to the beginning of the fiscal year, did the average value of your charity's property (cash, investments, capital property or other assets) not used directly in its charitable activities or administration: <br> 1) exceed $100,000, if the charity is designated as a charitable organization; or <br> 2) exceed $25,000, if the charity is designated as a public or private foundation? <br> • Line 5860 – Did the charity hold any donor advised funds (DAF) during the fiscal period? <br> • Line 5861 – Total number of accounts held at the end of the fiscal period |

<!-- Page 10 -->
UNCLASSIFIED
Page 10 of 44

UNCLASSIFIED - NON CLASSIFIÉ

- Line 5862 – Total value of all accounts held at the end of the fiscal period
- Line 5863 – Total value of donations to DAF accounts received during the fiscal period
- Line 5864 – Total value of qualifying disbursements from DAFs during the fiscal period

| Section D / Schedule 6 - add 7 new Lines & Remove 2 Lines | **Add seven new fields to Schedule 6** |
|---|---|
| | - Line 4101 - Enter the total amounts in cash and bank accounts included on line 4100 |
| | - Line 4102 - Enter the value of all short-term investments included on line 4100 with an original term to maturity not greater than one year |
| | - Line 4157 - Enter the cost or fair market value of all land and buildings in Canada used for the charity's charitable programs or administration |
| | - Line 4158 - Enter the cost or fair market value of all land and buildings in Canada not used for the charity's charitable programs or administration |
| | - Line 4190 - Enter the value of all impact investments including those reported in any other line. For the purposes of this guide, impact investments are investments in companies or projects with the intention of having a measurable positive environmental or social impact and generating a positive financial return |
| | - Line 4576 - Enter the amount from line 4580 that represents the total interest and other income the charity received or earned from impact investments |
| | - Line 4577 - Enter the total amount from Line 4580 that represents the total amount of interest and investment income received from persons who do not deal at arm's length with the charity |
| | **Remove 2 fields from Schedule 6 / Section D** |
| | - Line 4505 from Section D and Schedule 6 |
| | - Line 4180 from Schedule 6 |
| Schedule 1 Foundations – add 2 new lines | **Add 2 new fields** |
| | - Line 111 - What was the total value of all restricted funds held at the end of the fiscal period? |
| | - Line 112 - Of that amount, what amount was the foundation not permitted to spend due to a funder's written trust or direction |
| New Schedule 8 - Disbursement Quota | Schedule 8 Disbursement Quota will be introduced to allow organizations to calculate their disbursement quota for the current and following fiscal periods. The new schedule will be broken down over 3 pages. The first 2 pages will be Step 1 "Estimating the disbursement quota requirement for the current fiscal period" and Step 2 "Estimating the disbursement quota requirement for the next fiscal period"; page 3 will be a review page. |

UNCLASSIFIED - NON CLASSIFIÉ

Page **10** of 44


<!-- Page 11 -->
UNCLASSIFIED - NON CLASSIFIÉ

# UNCLASSIFIED

| Wording changes | **Wording changes for** |
|-----------------|------------------------|
| | • Line 200 |
| | • Line 2000 |
| | • Line 2100 |
| | • Line 5045 |
| | • Line 4890 |
| | • Line 4910 |

Page **11** of **44**

<!-- Page 12 -->
## 2. Relationship Diagram

This section documents the relationship between each dataset.

```
Charity Account and BN System information

┌─────────────────────────────────────────┐
│              Identification             │
└─────────────────────────────────────────┘
                    │
        ┌───────────┼───────────────────────────────────┐
        │           │                                   │
┌───────────────────────────┐                           │
│ Charity Account Contacts  │                           │
│  Account Contact Web      │◄──────────────────────────┤
│       Addresses           │                           │
└───────────────────────────┘                           │
                                                        │
┌───────────────────────────┐                           │
│ Form T3010                │                           │
│  General Information      │◄──────────────────────────┤
│  Financial Data           │◄──────────────────────────┤
│  Charitable Programs      │◄──────────────────────────┤
│  Schedule 1: Foundations  │◄──────────────────────────┤
│  Schedule 2: Activities   │◄──────────────────────────┤
│    (Financials)           │                           │
│  Schedule 2: Activities   │◄──────────────────────────┤
│    (Countries)            │                           │
│  Schedule 2: Activities   │◄──────────────────────────┤
│    (Exported Goods)       │                           │
│  Schedule 2: Activities   │◄──────────────────────────┤
│    (Resources)            │                           │
│  Schedule 3: Compensation │◄──────────────────────────┤
│  Schedule 5: Gifts in kind│◄──────────────────────────┤
│  Schedule 7: Public Policy│◄──────────────────────────┤
│    (Description)          │                           │
│  Schedule 7: Political    │◄──────────────────────────┤
│    Activities (Funding)   │                           │
│  Schedule 7: Political    │◄──────────────────────────┤
│    Activities (Resources) │                           │
│  Schedule 8: Disbursement │◄──────────────────────────┤
│    Quota                  │                           │
└───────────────────────────┘                           │
                                                        │
┌───────────────────────────┐                           │
│ Form T1235                │                           │
│  Directors/Officers       │◄──────────────────────────┤
└───────────────────────────┘                           │
┌───────────────────────────┐                           │
│ Form T1236                │                           │
│  Qualified Donees         │◄──────────────────────────┤
└───────────────────────────┘                           │
┌───────────────────────────┐                           │
│ Form T1441                │                           │
│  Non-Qualified Donees     │◄──────────────────────────┘
└───────────────────────────┘
```

<!-- Page 13 -->
# 3. Datasets

## 3.1 Identification

This dataset contains identification (tombstone) information about the charity such as the name and mailing address. The list only includes charities that have filed a T3010, *Registered Charity Information Return*, for the period concerned.

**File Name**: IDENT_<year>.csv

**Data Elements**:

| Key | Field | Type | Length | Description | Changes |
|-----|-------|------|--------|-------------|---------|
| 🔑 | BN | Text | 15 | Business number | None |
| | Category | Text | 4 | Category See **Category /Sub-Category code lists** in the Codes Lists PDF. | None |
| | Sub-Category | Text | 4 | Sub-Category See **Category /Sub-Category code lists** in the Codes Lists PDF. | Introduced in May 2019 release. |
| | Designation | Text | 1 | Designation See **Designation Code list** in the Codes Lists PDF. | None |
| | Legal Name | Text | 175 | Legal name of the charity | None |
| | Account Name | Text | 175 | Account name of the charity | None |
| | Address Line 1 | Text | 30 | Mailing address: Address Line 1 | None |
| | Address Line 2 | Text | 30 | Mailing address: Address Line 2 | None |
| | City | Text | 30 | Mailing address: City | None |
| | Province | Text | 2 | Mailing address: Province/State See **Province/United States Codes list** in the Codes Lists PDF. | None |
| | Postal Code | Text | 10 | Mailing address: Postal Code/Zip Code | None |
| | Country | Text | 2 | Mailing address: Country Code See **Country Code list** in the Codes Lists PDF. | None |

**Source:** Information we have in our records

<!-- Page 14 -->
## 3.2 Charity Contact Web Addresses

This dataset contains real-time web addresses related to the charity account (and not related to the T3010 filing).

**File Name**: WEBURL_<year>.csv

**Data Elements**:

| Key | Field | Type | Length | Start | End | Description | Changes (New File) |
|-----|-------|------|--------|-------|-----|-------------|-------------------|
| 🔑 | BN | Text | 15 | 1 | 15 | Business number | The concept of a separate contact .csv file has been introduced as part of May 2019 release. |
| 🔑 | # | Number | 9 | 16 | 24 | Sequence number to uniquely identify each item for a BN. | New |
| | Contact URL | Text | 200 | 25 | 224 | URL of the charity's website | New |

**Source:** Information we have in our records

<!-- Page 15 -->
## 3.3 Charities Businesses Directors/Officers

This dataset contains a list of directors/trustees and like officials.

**File Name**: DIRECTORS_<year>.csv

**Data Elements**:

| Key | Field | Type | Length | Description | Changes | Associated Form ID |
|-----|-------|------|--------|-------------|---------|-------------------|
| 🔑 | BN | Text | 15 | Business number | None | |
| 🔑 | FPE | Date | 10 | The month and day of the charity's fiscal year end. Charities must file their annual Form T3010 within six months of their fiscal year-end. | None | |
| 🔑 | Form ID | Text | 4 | Form version ID | None | |
| 🔑 | # | Number | 9 | Sequence number | None | |
| | Last Name | Text | 30 | Last name | None | |
| | First Name | Text | 30 | First name | None | |
| | Initials | Text | 3 | Initials | None | |
| | Position | Text | 30 | Position in the charity | None | |
| | At Arm's Length | Yes/No | 1 | Director at arm's length? | None | |
| | Start Date | Date | 10 | Date when the director was appointed in the position | None | |
| | End Date | Date | 10 | Date when the director ceased to be in the position | None | |

**Source:** T1235, *Directors/Trustees and Like Officials Worksheet*

<!-- Page 16 -->
## 3.4 Qualified Donees

This dataset contains a list of gifts charities have made to qualified donees and other organizations.

**File Name**: QUALIFIED_DONEES_\<year>.csv

**Data Elements**:

| Key | Field | Type | Length | Description | Changes | Associated Form ID |
|-----|-------|------|--------|-------------|---------|-------------------|
| 🔑 | BN | Text | 15 | Business number | None | |
| 🔑 | FPE | Date | 10 | The month and day of the charity's fiscal year end. Charities must file their annual Form T3010 within six months of their fiscal year-end. | None | |
| 🔑 | Form ID | Text | 4 | Form version ID | None | |
| 🔑 | # | Number | 9 | Sequence number | None | |
| | Donee BN | Text | 15 | Business number of qualified donee | None | |
| | Donee Name | Text | 175 | Name of qualified donee | None | |
| | Associated | Yes/No | 1 | Qualified donee is associated with charity | None | |
| | City | Text | 30 | | None | |
| | Province | Text | 2 | Province See **Province/United States Code list** (within the Codes Lists PDF). | None | |
| | Total Gifts | Amount | 14 | Total amounts of gifts | Empty for exempt charities | |
| | Gifts in Kind | Amount | 14 | | Empty for exempt charities | |
| | Political Activity Gift | Yes/No | 1 | Part of the gift intended for political activities? | Removed from version 24 of T3010 form. | 23 |
| | Political Activity Amount | Amount | 14 | Amount intended for political activities | Removed from version 24 of T3010 form. | 23 |

**Source:** T1236, *Qualified Donees Worksheet/Amounts Provided to Other Organizations*

<!-- Page 17 -->
## 3.5 Charitable Programs

This dataset contains a description of ongoing and new charitable programs the charity carried on during its fiscal period. The information is captured as such provided by the charity. The description can either be in English or French and no translation is provided.

**File Name**: NEW_ONGOING_PROGRAMS_<year>.csv

**Data Elements**:

| Key | Field | Type | Length | Description | Changes | Associated Form ID |
|-----|-------|------|--------|-------------|---------|-------------------|
| 🔑 | BN | Text | 15 | Business number | None | |
| 🔑 | FPE | Date | 10 | The month and day of the charity's fiscal year end. Charities must file their annual Form T3010 within six months of their fiscal year-end. | None | |
| 🔑 | Form ID | Text | 4 | Form version ID | None | |
| 🔑 | Program Type | Text | 2 | Program type code See **Program Type Code list** ( within the Codes Lists PDF). | None | |
| | Description | Text | 2500 | Description of the program | None | |

**Source:** T3010, *Registered Charity Information Return*
- Section C, question C2

<!-- Page 18 -->
## 3.6 General Information

**File Name**: FINANCIAL_SECTION_A_B_AND_C_<year>.csv

**Data Elements**:

| Key | Field | Type | Length | Description | Changes | Associated Form ID |
|-----|-------|------|--------|-------------|---------|-------------------|
| 🔑 | BN | Text | 15 | Business number | None | |
| | FPE | Date | 10 | The month and day of the charity's fiscal year end. Charities must file their annual Form T3010 within six months of their fiscal year-end. | None | |
| 🔑 | Form ID | Text | 4 | Form version ID | None | |
| | Program #1 Code | Text | 3 | Program Area #1 See **Program Area Code** list (within the Codes Lists PDF) | None | |
| | Program #1 % | Number | 3 | Program Area #1 - Percentage | None | |
| | Program #1 Desc | Text | 60 | Program Area #1 - Description | None | |
| | Program #2 Code | Text | 3 | Program Area #2 See **Program Area Code** list (within the Codes Lists PDF) | None | |
| | Program #2 % | Number | 3 | Program Area #2 - Percentage | None | |
| | Program #2 Desc | Text | 60 | Program Area #2 - Description | None | |
| | Program #3 Code | Text | 3 | Program Area #3 See **Program Area Code** list (within the Codes Lists PDF) | None | |
| | Program #3 % | Number | 3 | Program Area #3 - Percentage | None | |
| | Program #3 Desc | Text | 60 | Program Area #3 - Description | None | |
| | 1510 | Yes/No | 1 | Charity an internal division | None | |
| | 1510-BN | Text | 15 | Business number (BN) of internal division | None | |
| | 1510-Name | Text | 175 | Name of internal division | None | |
| | 1570 | Yes/No | 1 | Charity wound-up, dissolved, terminated | None | |
| | 1600 | Yes/No | 1 | Charity is public or private foundation | None | |
| | 1800 | Yes/No | 1 | Charity is active during fiscal year | None | |
| | 2000 | Yes/No | 1 | Charity make gifts or transfer funds to qualified donees or other organizations (excluding grants to non-qualified donees) | None | |

<!-- Page 19 -->
UNCLASSIFIED - NON CLASSIFIÉ

# UNCLASSIFIED

Page 19 of 44

| Field No | Type | Length | Description | Notes | Version |
|----------|------|--------|-------------|-------|---------|
| 2100 | Yes/No | 1 | Did the charity carry on, fund, or provide any resources through employees, volunteers, agents, joint ventures, contractors, or any other individuals, intermediaries, entities, or means (Excluding qualifying disbursements) for any activity/program/project outside Canada? | None | |
| 2400 | Yes/No | 1 | Charity carried on any political activities | Field no longer exists in version 25 | 23, 24 |
| 5030 | Amount | 14 | Total amount spent by the charity on political activities | Field no longer exists in version 24 Empty for exempt charities | 23 |
| 5031 | Amount | 14 | Of amount at line 5030, total amount of gifts made to qualified donees | Field no longer exists in version 24 Empty for exempt charities | 23 |
| 5032 | Amount | 14 | Total amount received from outside Canada that was directed to be spent on political activities | Field no longer exists in version 24 Empty for exempt charities | 23 |
| 2500 | Yes/No | 1 | Fundraising activity: Advertisements/print/radio/TV commercials | None | |
| 2510 | Yes/No | 1 | Fundraising activity: Auctions | None | |
| 2530 | Yes/No | 1 | Fundraising activity: Collection plate/boxes | None | |
| 2540 | Yes/No | 1 | Fundraising activity: Door-to-door solicitation | None | |
| 2550 | Yes/No | 1 | Fundraising activity: Draws/lotteries | None | |
| 2560 | Yes/No | 1 | Fundraising activity: Fundraising dinners/galas/concerts | None | |
| 2570 | Yes/No | 1 | Fundraising activity: Fundraising sales (e.g., cookies) | None | |
| 2575 | Yes/No | 1 | Fundraising activity: Internet | None | |
| 2580 | Yes/No | 1 | Fundraising activity: Mail campaigns | None | |

Page **19** of **44**


<!-- Page 20 -->
```
UNCLASSIFIED
Page 20 of 44
UNCLASSIFIED - NON CLASSIFIÉ
```

| | | | | |
|---|---|---|---|---|
| 2590 | Yes/No | 1 | Fundraising activity: Planned-giving programs | None |
| 2600 | Yes/No | 1 | Fundraising activity: Targeted corporate donations/sponsorships | None |
| 2610 | Yes/No | 1 | Fundraising activity: Targeted contacts | None |
| 2620 | Yes/No | 1 | Fundraising activity: Telephone/TV solicitations | None |
| 2630 | Yes/No | 1 | Fundraising activity: Tournament/sporting events | None |
| 2640 | Yes/No | 1 | Fundraising activity: Cause-related marketing | None |
| 2650 | Yes/No | 1 | Fundraising activity: Other | None |
| 2660 | Text | 175 | Fundraising activity: Specify | None |
| 2700 | Yes/No | 1 | Charity paid external fundraisers | None |
| 5450 | Amount | 14 | Gross revenue collected by the fundraisers on behalf of the charity | Empty for exempt charities |
| 5460 | Amount | 14 | Amounts paid to and/or retained by the fundraisers | Empty for exempt charities |
| 2730 | Yes/No | 1 | External fundraisers: Commissions | None |
| 2740 | Yes/No | 1 | External fundraisers: Bonuses | None |
| 2750 | Yes/No | 1 | External fundraisers: Finder's fees | None |
| 2760 | Yes/No | 1 | External fundraisers: Set fee for services | None |
| 2770 | Yes/No | 1 | External fundraisers: Honoraria | None |
| 2780 | Yes/No | 1 | External fundraisers: Other | None |
| 2790 | Text | 175 | External fundraisers: Specify | None |
| 2800 | Yes/No | 1 | Fundraiser issued tax receipts on behalf of the charity | None |
| 3200 | Yes/No | 1 | Charity compensated its directors/trustees or like officials or persons not at arm's length from the charity for services provided during the fiscal period (other than reimbursement for expenses) | None |
| 3400 | Yes/No | 1 | Charity incurred any expenses for compensation of employees | None |
| 3900 | Yes/No | 1 | Charity received any donations or gifts of any kind valued at $10,000 or more from any donor that was not resident in Canada | None |
| 4000 | Yes/No | 1 | Charity received any non-cash gifts (gifts-in-kind) for which it issued tax receipts | None |
| 5800 | Yes/No | 1 | Charity acquired a non-qualifying security | None |

<!-- Page 21 -->
UNCLASSIFIED
Page 21 of 44
UNCLASSIFIED - NON CLASSIFIÉ

| | | | | | |
|---|---|---|---|---|---|
| 5810 | Yes/No | 1 | Charity allowed a donor to use any of the charity's property | None | |
| 5820 | Yes/No | 1 | Charity issued any of its tax receipts for donations on behalf of another organization | None | |
| 5830 | Yes/No | 1 | Charity has direct partnership holdings at any time during the fiscal period? **Note**: Only available with FPE starting in December 2015. | None | |
| 5840 | Yes/No | 1 | Did the charity make qualifying disbursements by way of grants to non-qualified donees (grantees) in the fiscal period? | None | 26 |
| 5841 | Yes/No | 1 | Did the charity make grants to any grantees totalling more than $5000 in the fiscal period? | None | 26 |
| 5842 | Number | 10 | Enter the number of grantees that received grants totalling $5,000 or less in the fiscal period | None | 26 |
| 5843 | Amount | 17 | Enter the total amount paid to grantees that received grants totalling $5,000 or less in the fiscal period | Empty for exempt charities | 26 |
| 5850 | Yes/No | 1 | In the 24 months prior to the beginning of the fiscal year, did the average value of your charity's property (cash, investments, capital property or other assets) not used directly in its charitable activities or administration: a) exceed $100,000, if the charity is designated as a charitable organization; or b) exceed $25,000, if the charity is designated as a public or private foundation? | None | 27 |
| 5860 | Yes/No | 1 | Did the charity hold any donor advised funds (DAF) during the fiscal period? | None | 27 |
| 5861 | Number | 10 | Total number of accounts held at the end of the fiscal period | None | 27 |
| 5862 | Amount | 17 | Total value of all accounts held at the end of the fiscal period | Empty for exempt charities | 27 |
| 5863 | Amount | 17 | Total value of donations to DAF accounts received during the fiscal period | Empty for exempt charities | 27 |


<!-- Page 22 -->
| 5864 | Amount | 17 | Total value of qualifying disbursements from DAFs during the fiscal period | Empty for exempt charities | 27 |
|------|--------|----|---------------------------------------------------------------------------|-----------------------------|-----|

**Source:** T3010, *Registered Charity Information Return*
- Section A, Identification
- Section C, Programs and general information


<!-- Page 23 -->
## 3.7 Financial Data

This dataset documents financial data found in the *T3010*, Section D and Schedule 6. The field **Section Used** indicates which portion of the T3010 the charity used to file the financial data. A detailed description of the line numbers (e.g. 4020, 4050, etc.) can be found in the T4033 guide, *Completing the Registered Charity Information Return.*

**File Name**: FINANCIAL D_AND _SCHEDULE_6_<year>.csv

**Data Elements**:

| Key | Field | Type | Length | Description | Changes | Associated Form ID |
|-----|-------|------|--------|-------------|---------|-------------------|
| 🔑 | BN | Text | 15 | Business number | None | |
| | FPE | Date | 10 | The month and day of the charity's fiscal year end. Charities must file their annual Form T3010 within six months of their fiscal year-end. | None | |
| 🔑 | Form ID | Text | 4 | Form version ID | None | |
| | Section Used | Text | 1 | Section used to filed the financial data Values: D=Section D, 6=Schedule 6 | None | |
| | 4020 | Text | 1 | Financial information reported on accrual or cash basis Values: A=Accrual, C=Cash basis | Empty for exempt charities | |
| | 4050 | Yes/No | 1 | Charity owned land and/or buildings | None | |
| | 4100 | Amount | 14 | Cash, bank accounts and short-term investments | Empty for exempt charities | |
| | 4110 | Amount | 14 | Amounts receivable from non-arm's length parties | Empty for exempt charities | |
| | 4120 | Amount | 14 | Amounts received from others | Empty for exempt charities | |
| | 4130 | Amount | 14 | Investments in non-arm's length parties | Empty for exempt charities | |
| | 4140 | Amount | 14 | Long-term investments | Empty for exempt charities | |
| | 4150 | Amount | 14 | Inventories | Empty for exempt charities | |
| | 4155 | Amount | 14 | Land and buildings in Canada | Empty for exempt charities | |
| | 4160 | Amount | 14 | Other capital assets in Canada | Empty for exempt charities | |
| | 4165 | Amount | 14 | Capital assets outside Canada | Empty for exempt charities | |

UNCLASSIFIED

Page **23** of **44**

<!-- Page 24 -->
UNCLASSIFIED
Page 24 of 44
UNCLASSIFIED - NON CLASSIFIÉ

| Field | Type | Length | Description | Notes |
|-------|------|--------|-------------|-------|
| 4166 | Amount | 14 | Accumulated amortization of capital assets | Empty for exempt charities |
| 4170 | Amount | 14 | Other assets | Empty for exempt charities |
| 4180 | Amount | 14 | 10 year gifts | Removed from T3010 V27 Empty for exempt charities | 27 |
| 4200 | Amount | 14 | Total assets | Empty for exempt charities |
| 4250 | Amount | 14 | Amount in lines 4150, 4155, 4160, 4165, 4170 not used in charitable programs | Empty for exempt charities |
| 4300 | Amount | 14 | Accounts payable and accrued liabilities | Empty for exempt charities |
| 4310 | Amount | 14 | Deferred revenue | Empty for exempt charities |
| 4320 | Amount | 14 | Amounts owing to non-arm's length parties | Empty for exempt charities |
| 4330 | Amount | 14 | Other liabilities | Empty for exempt charities |
| 4350 | Amount | 14 | Total liabilities | Empty for exempt charities |
| 4400 | Yes/No | 1 | Charity borrowed from, loaned to, or invested assets with any non-arm's length parties | None |
| 4490 | Yes/No | 1 | Charity issued tax receipts for donations | None |
| 4500 | Amount | 14 | Total eligible amount of tax-receipted gifts | Empty for exempt charities |
| 5610 | Amount | 14 | Total eligible amount of tax-receipted tuition fees | Empty for exempt charities |
| 4505 | Amount | 14 | Total amount of 10 year gifts received | Removed from T3010 V27 Empty for exempt charities | 27 |
| 4510 | Amount | 14 | Total received from other charities (excluding specified gifts & enduring property) | Empty for exempt charities |


<!-- Page 25 -->
UNCLASSIFIED
Page 25 of 44
UNCLASSIFIED - NON CLASSIFIÉ

# UNCLASSIFIED

| | | | | |
|---|---|---|---|---|
| 4530 | Amount | 14 | Total other gifts for which a tax receipt was not issued by the charity | Empty for exempt charities |
| 4540 | Amount | 14 | Revenue received from federal government | Empty for exempt charities |
| 4550 | Amount | 14 | Revenue received from provincial/territorial governments | Empty for exempt charities |
| 4560 | Amount | 14 | Revenue received from municipal/regional governments | Empty for exempt charities |
| 4565 | Yes/No | 1 | Charity received revenue from any level of Canadian government | None |
| 4570 | Amount | 14 | Amount received from any level of Canadian government | Empty for exempt charities |
| 4571 | Amount | 14 | Total tax-receipted revenue from all sources outside of Canada | Empty for exempt charities |
| 4575 | Amount | 14 | Revenue received from sources outside Canada | Empty for exempt charities |
| 4580 | Amount | 14 | Interest and investment income | Empty for exempt charities |
| 4590 | Amount | 14 | Gross proceeds from disposition of assets | Empty for exempt charities |
| 4600 | Amount | 14 | Net proceeds from disposition of assets | Empty for exempt charities |
| 4610 | Amount | 14 | Rental income (land and buildings) | Empty for exempt charities |
| 4620 | Amount | 14 | Memberships, dues, association fees (non tax-receipted) | Empty for exempt charities |
| 4630 | Amount | 14 | Total revenue from fundraising activities not reported above as gifts | Empty for exempt charities |
| 4640 | Amount | 14 | Total revenue from sale of goods and services (except to government) | Empty for exempt charities |
| 4650 | Amount | 14 | Other Income (not already included in the amounts above) | Empty for exempt charities |
| 4655 | Text | 175 | Specify type of revenue of line 4650 | None |
| 4700 | Amount | 14 | Total revenue (lines 4500, 4510 to 4580, 4600 to 4650) | Empty for exempt charities |
| 4800 | Amount | 14 | Advertising and promotion | Empty for exempt charities |

Page **25** of **44**


<!-- Page 26 -->
UNCLASSIFIED
Page 26 of 44
UNCLASSIFIED - NON CLASSIFIÉ

| Field | Type | Size | Description | Notes |
|-------|------|------|-------------|-------|
| 4810 | Amount | 14 | Travel and vehicle | Empty for exempt charities |
| 4820 | Amount | 14 | Interest and bank charges | Empty for exempt charities |
| 4830 | Amount | 14 | Licenses, memberships, dues | Empty for exempt charities |
| 4840 | Amount | 14 | Office supplies and expenses | Empty for exempt charities |
| 4850 | Amount | 14 | Occupancy costs | Empty for exempt charities |
| 4860 | Amount | 14 | Professional and consulting fees | Empty for exempt charities |
| 4870 | Amount | 14 | Education and training for staff and volunteers | Empty for exempt charities |
| 4880 | Amount | 14 | Total expenditures on all compensations | Empty for exempt charities |
| 4890 | Amount | 14 | Fair market value of all donated goods used in charity's own activities | Empty for exempt charities |
| 4891 | Amount | 14 | Total cost of all purchased supplies and assets | Empty for exempt charities |
| 4900 | Amount | 14 | Amortization of capitalized assets | Empty for exempt charities |
| 4910 | Amount | 14 | Research grants, scholarships as part of charity's own activities | Empty for exempt charities |
| 4920 | Amount | 14 | Other expenditures | Empty for exempt charities |
| 4930 | Text | 175 | Specify types of expenditures included in amount reported at 4920 | None |
| 4950 | Amount | 14 | Total expenditures (excluding qualifying disbursements) | Empty for exempt charities |
| 5000 | Amount | 14 | Total charitable programs expenditures included in line 4950 | Empty for exempt charities |
| 5010 | Amount | 14 | Total management and administration expenditures included in line 4950 | Empty for exempt charities |
| 5020 | Amount | 14 | Total fundraising expenditures (included in line 4950) | Empty for exempt charities |


<!-- Page 27 -->
UNCLASSIFIED
Page 27 of 44
UNCLASSIFIED - NON CLASSIFIÉ

| Field No | Type | Version | Description | Notes | Page |
|----------|------|---------|-------------|-------|------|
| 5030 | Amount | 14 | Total expenditures on political activities (included in line 4950) | Field no longer exists in version 24 Empty for exempt charities | 23 |
| 5040 | Amount | 14 | Total other activity expenditures (included in line 4950) | Empty for exempt charities | |
| 5050 | Amount | 14 | Total gifts to qualified donees excluding enduring property and specified gifts | Empty for exempt charities | |
| 5100 | Amount | 14 | Total expenditures | Empty for exempt charities | |
| 5500 | Amount | 14 | Amount accumulated this fiscal period, including income earned this fiscal year on previously accumulated funds | Empty for exempt charities | |
| 5510 | Amount | 14 | Amount disbursed this fiscal period for the specified purpose for which permission has been granted | Empty for exempt charities | |
| 5750 | Amount | 14 | Pre-approved special reduction amount used in disbursement quota | Empty for exempt charities | |
| 5900 | Amount | 14 | Average value of property not used for charitable programs or administration during 24 months preceding the beginning of fiscal period | Empty for exempt charities | |
| 5910 | Amount | 14 | Average value of property not used for charitable programs or administration during 24 months preceding the end of fiscal period | Empty for exempt charities | |
| 5045 | Amount | 17 | Total amount of grants made to all non-qualified donees (grantees) | Empty for exempt charities | 26 |
| 4101 | Amount | 17 | Enter the total amounts in cash and bank accounts included on line 4100 | Empty for exempt charities | 27 |
| 4102 | Amount | 17 | Enter the value of all short-term investments included on line 4100 with an original term to maturity not greater than one year | Empty for exempt charities | 27 |
| 4157 | Amount | 17 | Enter the cost or fair market value of all land and buildings in Canada used for the charity's charitable programs or administration | Empty for exempt charities | 27 |


<!-- Page 28 -->
| 4158 | Amount | 17 | Enter the cost or fair market value of all land and buildings in Canada not used for the charity's charitable programs or administration | Empty for exempt charities | 27 |
|------|--------|----|------------------------------------------------------------------------------------------------------------------------------------|---------------------------|-----|
| 4190 | Amount | 17 | Enter the value of all impact investments including those reported in any other line. For the purposes of this guide, impact investments are investments in companies or projects with the intention of having a measurable positive environmental or social impact and generating a positive financial return | Empty for exempt charities | 27 |
| 4576 | Amount | 17 | Enter the amount from line 4580 that represents the total interest and other income the charity received or earned from impact investments | Empty for exempt charities | 27 |
| 4577 | Amount | 17 | Enter the total amount from Line 4580 that represents the total amount of interest and investment income received from persons who do not deal at arm's length with the charity | Empty for exempt charities | 27 |

**Source:** T3010, *Registered Charity Information Return*
- Section D, Financial information
- Schedule 6, Detailed financial information


<!-- Page 29 -->
## 3.8 Private/Public Foundations

**File Name**: SCHEDULE_1_FOUNDATIONS_<year>.csv

**Data Elements**:

| Key | Field | Type | Length | Description | Changes | Associated Form ID |
|-----|-------|------|--------|-------------|---------|-------------------|
| 🔑 | BN | Text | 15 | Business number | None | |
| 🔑 | FPE | Date | 10 | The month and day of the charity's fiscal year end. Charities must file their annual Form T3010 within six months of their fiscal year-end. | None | |
| 🔑 | Form ID | Text | 4 | Form version ID | None | |
| | 100 | Yes/No | 1 | Did the foundation acquired control of a corporation in the fiscal period | None | |
| | 110 | Yes/No | 1 | Did the foundation incur any debts during the FPE other than current operating expenses in buy/sell of investment, or administering charitable programs | None | |
| | 120 | Yes/No | 1 | During fiscal period, did foundation hold shares, right to acquire such shares or debt owing to it that are non-qualifying investment | None | |
| | 130 | Yes/No | 1 | Did the foundation own more than 2% of any class of shares of a corporation at any time during the fiscal period | None | |
| | 111 | Amount | 17 | What was the total value of all restricted funds held at the end of the fiscal period? | Empty for exempt charities | 27 |
| | 112 | Amount | 17 | Of that amount, what amount was the foundation not permitted to spend due to a funder's written trust or direction? | Empty for exempt charities | 27 |

**Source:** T3010, *Registered Charity Information Return*
- Schedule 1, Foundations

<!-- Page 30 -->
## 3.9 Activities Outside Canada - Details on financial

**File Name**: SCHEDULE_2_DETAILS_<year>.csv

**Data Elements**:

| Key | Field | Type | Length | Description | Changes | Associated Form ID |
|-----|-------|------|--------|-------------|---------|-------------------|
| 🔑 | BN | Text | 15 | Business number | None | |
| 🔑 | FPE | Date | 10 | The month and day of the charity's fiscal year end. Charities must file their annual Form T3010 within six months of their fiscal year-end. | None | |
| 🔑 | Form ID | Text | 4 | Form version ID | None | |
| | 200 | Amount | 14 | Total expenditures on activities carried on outside Canada (excluding qualifying disbursements) | Empty for exempt charities | |
| | 210 | Yes/No | 1 | Charity's resources provided for programs outside Canada to any other individual or entity (excluding qualifying disbursements) | None | |
| | 220 | Yes/No | 1 | Projects undertaken outside Canada funded by the Global Affairs | In May 2019 release the term "CIDA" was changed to "Global Affairs". | |
| | 230 | Amount | 14 | Total amount of funds expended for programs funded by Global Affairs | Empty for exempt charities | |
| | 240 | Yes/No | 1 | Programs carried on outside Canada carried out by employees of the charity | None | |
| | 250 | Yes/No | 1 | Programs carried on outside Canada carried out by volunteers of the charity | None | |

<!-- Page 31 -->
| 260 | Yes/No | 1 | Charity exporting goods as part of its charitable programs | None | |

**Source:** T3010, *Registered Charity Information Return*
- Schedule 2


<!-- Page 32 -->
## 3.10 Activities outside Canada – Countries where program was carried

This dataset contains a list of countries for charities that carried on programs or devoted any of its resources outside of Canada.

**File Name**: SCHEDULE_2_COUNTRIES_<year>.csv

**Data Elements**:

| Key | Field | Type | Length | Description | Changes | Associated Form ID |
|-----|-------|------|--------|-------------|---------|-------------------|
| 🔑 | BN | Text | 15 | Business number | None | |
| 🔑 | FPE | Date | 10 | The month and day of the charity's fiscal year end. Charities must file their annual Form T3010 within six months of their fiscal year-end. | None | |
| 🔑 | Form ID | Text | 4 | Form version ID | None | |
| 🔑 | # | Number | 9 | Sequence number | None | |
| | Country | Text | 2 | Country code where program was carried See **Country Code list** (within the Codes Lists PDF). | None | |

**Source:** T3010, *Registered Charity Information Return*
- Schedule 2, question 3

<!-- Page 33 -->
## 3.11 Activities outside Canada –Exported goods

This dataset contains a list of goods that were exported abroad.

**File Name**: SCHEDULE_2_GOODS_<year>.csv

**Data Elements**:

| Key | Field | Type | Length | Description | Changes | Associated Form ID |
|-----|-------|------|--------|-------------|---------|-------------------|
| 🔑 | BN | Text | 15 | Business number | None | |
| 🔑 | FPE | Date | 10 | The month and day of the charity's fiscal year end. Charities must file their annual Form T3010 within six months of their fiscal year-end. | None | |
| 🔑 | Form ID | Text | 4 | Form version ID | None | |
| 🔑 | # | Number | 9 | Sequence number | None | |
| | Item Name | Text | 30 | Item being exported | None | |
| | Item Value | Amount | 14 | Item's value | Empty for exempt charities | |
| | Destination | Text | 175 | Destination of the item | None | |
| | Country | Text | 2 | Country code of the destination See **Country Code list** (within the Codes Lists PDF). | None | |

**Source:** T3010, *Registered Charity Information Return*
- Schedule 2, question 7 (table only)

<!-- Page 34 -->
## 3.12 Activities Outside Canada - Financial resources used

**File Name**: SCHEDULE_2_RESOURCES_<year>.csv

**Data Elements**:

| Key | Field | Type | Length | Description | Changes | Associated Form ID |
|-----|-------|------|--------|-------------|---------|-------------------|
| 🔑 | BN | Text | 15 | Business number | None | |
| 🔑 | FPE | Date | 10 | The month and day of the charity's fiscal year end. Charities must file their annual Form T3010 within six months of their fiscal year-end. | None | |
| 🔑 | Form ID | Text | 4 | Form version ID | None | |
| 🔑 | # | Number | 9 | Sequence number | None | |
| | Org Name | Text | 175 | Name of individual/organization | None | |
| | Amount | Amount | 14 | Amount transferred to individual/organization | Empty for exempt charities | |
| | Country | Text | 2 | Country code where activities were carried out See **Country Code list** (within the Codes Lists PDF). | None | |

**Source:** T3010, *Registered Charity Information Return*
- Schedule 2, question 2 (table only)

<!-- Page 35 -->
## 3.13 Compensation

This dataset contains information on compensation of employees.

**File Name**: SCHEDULE_3_COMPENSATION_<year>.csv

**Data Elements**

| Key | Field | Type | Length | Description | Changes | Associated Form ID |
|-----|-------|------|--------|-------------|---------|-------------------|
| 🔑 | BN | Text | 15 | Business number | None | |
| 🔑 | FPE | Date | 10 | The month and day of the charity's fiscal year end. Charities must file their annual Form T3010 within six months of their fiscal year-end. | None | |
| 🔑 | Form ID | Text | 4 | Form version ID | None | |
| | 300 | Number | 5 | Number of permanent, full-time, compensated positions | Empty for exempt charities | |
| | 305 | Number | 5 | $1-39,999 (of the 10 highest compensated) | Empty for exempt charities | |
| | 310 | Number | 5 | $40,000-$79,999 (of the 10 highest compensated) | Empty for exempt charities | |
| | 315 | Number | 5 | $80,000-119,999 (of the 10 highest compensated) | Empty for exempt charities | |
| | 320 | Number | 5 | $120,000-159,999 (of the 10 highest compensated) | Empty for exempt charities | |
| | 325 | Number | 5 | $160,000-199,999 (of the 10 highest compensated) | Empty for exempt charities | |
| | 330 | Number | 5 | $200,000-249,999 (of the 10 highest compensated) | Empty for exempt charities | |
| | 335 | Number | 5 | $250,000-299,999 (of the 10 highest compensated) | Empty for exempt charities | |
| | 340 | Number | 5 | $300,000-349,999 (of the 10 highest compensated) | Empty for exempt charities | |
| | 345 | Number | 5 | $350,000 and over (of the 10 highest compensated) | Empty for exempt charities | |
| | 370 | Number | 5 | Number of part-time or part-year employees | Empty for exempt charities | |
| | 380 | Amount | 14 | Total expenditures on compensation for parttime or part-year employees | Empty for exempt charities | |
| | 390 | Amount | 14 | Total expenditures on all compensation | Empty for exempt charities | |

**Source:** T3010, *Registered Charity Information Return*
- Schedule 3, Compensation

<!-- Page 36 -->
## 3.14 Non-cash gifts (gifts in kind) received

**File Name**: SCHEDULE_5_GIFTS_IN_KIND_<year>.csv

**Data Elements**:

| Key | Field | Type | Length | Description | Changes | Associated Form ID |
|-----|-------|------|--------|-------------|---------|-------------------|
| 🔑 | BN | Text | 15 | Business number | None | |
| 🔑 | FPE | Date | 10 | The month and day of the charity's fiscal year end. Charities must file their annual Form T3010 within six months of their fiscal year-end. | None | |
| 🔑 | Form ID | Text | 4 | Form version ID | None | |
| | 500 | Yes/No | 1 | Charity issue receipts for artwork wine jewellery | None | |
| | 505 | Yes/No | 1 | Charity issue receipts for building materials | None | |
| | 510 | Yes/No | 1 | Charity issue receipts for clothing furniture food | None | |
| | 515 | Yes/No | 1 | Charity issue receipts for vehicles | None | |
| | 520 | Yes/No | 1 | Charity issue receipts for cultural properties | None | |
| | 525 | Yes/No | 1 | Charity issue receipts for ecological properties | None | |
| | 530 | Yes/No | 1 | Charity issue receipts for life insurance policies | None | |
| | 535 | Yes/No | 1 | Charity issue receipts for medical equipment/supplies | None | |
| | 540 | Yes/No | 1 | Charity issue receipts for privately held securities | None | |
| | 545 | Yes/No | 1 | Charity issue receipts for machinery/equipment (including computers & software) | None | |
| | 550 | Yes/No | 1 | Charity issue receipts for publicly traded securities/mutual funds | None | |
| | 555 | Yes/No | 1 | Charity issue receipts for books (literature, comics) | None | |
| | 560 | Yes/No | 1 | Other | None | |
| | 565 | Text | 175 | Other: Specify | None | |
| | 580 | Amount | 14 | Total eligible amount for noncash gifts with receipts | Empty for exempt charities | |

**Source:** T3010, *Registered Charity Information Return*
- Schedule 5, Gifts in kind

<!-- Page 37 -->
UNCLASSIFIED

## 3.15 Political Activities / Public Policy and Development Activities

**File Name**: SCHEDULE_7_ DESCRIPTION_<year>.csv

Special note: "Political Activities" was renamed "Public Policy and Development Activities" in version 24 of the T3010 form.

**Data Elements**:

| Key | Field | Type | Length | Description | Changes | Associated Form ID |
|-----|-------|------|--------|-------------|---------|-------------------|
| 🔑 | BN | Text | 15 | Business number | T3010 version 25 no longer provides the data in this table | 23, 24 |
| 🔑 | FPE | Date | 10 | The month and day of the charity's fiscal year end. Charities must file their annual Form T3010 within six months of their fiscal year-end. | None | 23, 24 |
| 🔑 | Form ID | Text | 4 | Form version ID | None | 23, 24 |
| | Description | Text | 2500 | Description of charity's public policy and how it relates to its charitable purposes | None | 23, 24 |

**Source:** T3010, *Registered Charity Information Return*
- Schedule 7, question 1

UNCLASSIFIED - NON CLASSIFIÉ

Page **37** of 44

<!-- Page 38 -->
## 3.16 Political Activities – Funding

**File Name**: SCHEDULE_7_PA_FUNDING_FROM_OUTSIDE_CA_<year>.csv

**Data Elements**:

| Key | Field | Type | Length | Description | Changes | Associated Form ID |
|-----|-------|------|--------|-------------|---------|-------------------|
| 🔑 | BN | Text | 15 | Business number | Data in this table no longer exists in T3010 version 24 | 23 |
| 🔑 | FPE | Date | 10 | The month and day of the charity's fiscal year end. Charities must file their annual Form T3010 within six months of their fiscal year-end. | None | 23 |
| 🔑 | Form ID | Text | 4 | Form version ID | None | 23 |
| 🔑 | # | Number | 9 | Sequence number | None | 23 |
| | Activity | Text | 175 | Name of the political activity | None | 23 |
| | Amount | Amount | 14 | Amount received | Empty for exempt charities | 23 |
| | Country | Text | 2 | Country code of the source of funding See **Country Code list** (within the Codes Lists PDF). | None | 23 |

**Source:** T3010, *Registered Charity Information Return*
- Schedule 7, question 3

<!-- Page 39 -->
## 3.17 Political Activities – Resources

**File Name**: SCHEDULE_7_PA_RESOURCES_<year>.csv

**Data Elements**:

| Key | Field | Type | Length | Description | Changes | Associated Form ID |
|-----|-------|------|--------|-------------|---------|-------------------|
| 🔑 | BN | Text | 15 | Business number | Data in this table no longer exists in T3010 version 24 | 23 |
| 🔑 | FPE | Date | 10 | The month and day of the charity's fiscal year end. Charities must file their annual Form T3010 within six months of their fiscal year-end. | None | 23 |
| 🔑 | Form ID | Text | 4 | Form version ID | None | 23 |
| 🔑 | # | Number | 9 | Sequence number (1=Line 700, 2=Line 701, …, 9=Line 708) | None | 23 |
| | Staff | Text | 1 | Staff resources used | None | 23 |
| | Volunteers | Text | 1 | Volunteers resources used | None | 23 |
| | Financial | Text | 1 | Financial resources used | None | 23 |
| | Property | Text | 1 | Property resources used | None | 23 |
| | Other | Text | 175 | Other ways charity participated in or carried out political activities (only applicable to line 708) | None | 23 |

**Source:** T3010, *Registered Charity Information Return*
- Schedule 7, question 2

<!-- Page 40 -->
## 3.18 Grants to Non-Qualified Donees

This dataset contains a list of qualifying disbursements to non-qualified donees (grantees).

**File Name**: NONQD_<YEAR>.csv

**Data Elements**:

| Key | Field | Type | Length | Description | Changes | Associated Form ID |
|-----|-------|------|--------|-------------|---------|-------------------|
| 🔑 | BN | Text | 15 | Business number | New table T3010 version 26 | 26 |
| 🔑 | FPE | Date | 10 | The month and day of the charity's fiscal year end. Charities must file their annual Form T3010 within six months of their fiscal year-end. | None | 26 |
| 🔑 | Form ID | Text | 4 | Form version ID | None | 26 |
| 🔑 | Sequence Number | Number | 10 | Sequence number to uniquely identify each grant recipient for a BN/FPE | None | 26 |
| | Filing Date | Date | 10 | Date return was filed by the charity | None | 26 |
| | Grant Recipient Name | Text | 175 | Name of non-qualified donee | None | 26 |
| | Grant Purpose | Text | 1250 | Description of the purpose for the qualifying disbursements to non-qualified donee | None | 26 |
| | Amount of Cash Disbursement | Amount | 17 | Cash amount disbursed to non-qualified donee | Empty for exempt charities | 26 |
| | Amount of Non-Cash Disbursement | Amount | 17 | Non-cash amount disbursed to non-qualified donee | Empty for exempt charities | 26 |
| | Grant Country | Text | 125 | List of grant Countries | None | 26 |

**Source(s):**
T1441, *Qualifying disbursements: Grants to non-qualified donees (grantees) form*

<!-- Page 41 -->
## 3.19 Schedule 8 Disbursement Quota

This dataset contains the calculations of disbursement quota for current and next fiscal year

**File Name**: SCHEDULE_8_DQ.<YEAR>.csv

**Data Elements**:

| Key | Field | Type | Length | Description | Changes | Associated Form ID |
|-----|-------|------|--------|-------------|---------|-------------------|
| 🔑 | BN | Text | 15 | Business number | None | 27 |
| 🔑 | FPE | Date | 10 | The month and day of the charity's fiscal year end. Charities must file their annual Form T3010 within six months of their fiscal year-end. | None | 27 |
| 🔑 | Form ID | Text | 4 | Form version ID | None | 27 |
| | Filing Date | Date | 10 | Date return was filed by the charity | None | 27 |
| | Line 805 | Amount | 17 | Average value of property not used in charitable activities or administration (line 5900 from your return) | Empty for exempt charities | 27 |
| | Line 810 | Amount | 17 | If permission to accumulate property has been granted, enter the total amount accumulated less all disbursements made for the specified purpose (add all amounts from lines 5500 minus all amounts at lines 5510 from all returns to date covered by the permission to accumulate property period) | Empty for exempt charities | 27 |
| | Line 815 | Amount | 17 | Must display the total of The amount at line 805 minus the amount at line 810 "Line 1 minus line 2 (if negative, enter 0)" | Empty for exempt charities | 27 |
| | Line 820 | Amount | 17 | If the amount at line 3 is less than or equal to 1,000,000, Must display the total of line 815 multiplied by 3.5%; If the amount at line 3 is more than 1,000,000, Must remain blank | Empty for exempt charities | 27 |

<!-- Page 42 -->
UNCLASSIFIED
Page 42 of 44
UNCLASSIFIED - NON CLASSIFIÉ

| Line | Field Type | | Rules | Description | Notes | Page |
|------|-----------|---|-------|-------------|-------|------|
| Line 825 | Amount | 17 | If the amount at line 3 is less than or equal to 1,000,000, Must remain blank<br><br>If the amount at line 3 is more than 1,000,000, Must display the total of line 815 minus $1,000,000 | | Empty for exempt charities | 27 |
| Line 830 | Amount | 17 | If the amount at line 3 is less than or equal to 1,000,000, Must remain blank<br><br>If the amount at line 3 is more than 1,000,000, Must display the total of line 825 multiplied by 5% | | Empty for exempt charities | 27 |
| Line 835 | Amount | 17 | If the amount at line 3 is less than or equal to 1,000,000, Must remain blank<br><br>If the amount at line 3 is more than 1,000,000, Must display the total of line 830 plus $35,000 | | Empty for exempt charities | 27 |
| Line 840 | Amount | 17 | Must be pre-populated with the amount from line 820 or 835 from Page 1 of Schedule 8 | "Enter the amount from line 820 or line 835. This is your charity's disbursement quota requirement for the current fiscal period" | Empty for exempt charities | 27 |
| Line 845 | Amount | 17 | Must be pre-populated with the amount from line 5000 from Schedule 6 of this return | "Total expenditures on charitable activities (line 5000 of your return)" | Empty for exempt charities | 27 |
| Line 850 | Amount | 17 | Must be pre-populated with the amount from line 5045 from Schedule 6 of this return | "Total amount of grants made to non-qualified donees (line 5045 of your return)" | Empty for exempt charities | 27 |
| Line 855 | Amount | 17 | Must be pre-populated with the amount from line 5050 from Schedule 6 of this return | "Total amount of gifts made to qualified donees (line 5050 of your return)" | Empty for exempt charities | 27 |


<!-- Page 43 -->
UNCLASSIFIED
Page 43 of 44
UNCLASSIFIED - NON CLASSIFIÉ

| Line | Type | | Rules | Description | Notes | Page |
|------|------|--|-------|-------------|-------|------|
| Line 860 | Amount | 17 | Must display the total of adding lines 845, 850 and 855 | | Empty for exempt charities | 27 |
| Line 865 | Amount | 17 | Must display the total of subtracting line 860 from line 840 | "Line 860 minus line 840. This is your charity's disbursement quota excess or shortfall for the current fiscal period." | Empty for exempt charities | 27 |
| Line 870 | Amount | 17 | Must be pre-populated with the amount from line 5910 from Schedule 6 of this return | "Average value of property not used in charitable activities or administration prior to the next fiscal period (line 5910 from your return)" | Empty for exempt charities | 27 |
| Line 875 | Amount | 17 | If the amount at line 870 is less than or equal to 1,000,000, Must display the total of line 870 multiplied by 3.5% If the amount at line 870 is more than 1,000,000, Must remain blank | "The amount shown on line 875 is your charity's estimated disbursement quota requirement for the next fiscal period." | Empty for exempt charities | 27 |
| Line 880 | Amount | 17 | If the amount at line 870 is less than or equal to 1,000,000, Must remain blank If the amount at line 870 is more than 1,000,000, Must display the total of line 870 minus $1,000,000 | | Empty for exempt charities | 27 |
| Line 885 | Amount | 17 | If the amount at line 870 is less than or equal to 1,000,000, Must remain blank If the amount at line 870 is more than 1,000,000, Must display the total of line 880 multiplied by 5% | | Empty for exempt charities | 27 |
| Line 890 | Amount | 17 | If the amount at line 870 is less than or equal to 1,000,000, Must remain blank If the amount at line 870 is more than 1,000,000, Must display the total of line 885 plus $35,000 | | Empty for exempt charities | 27 |


<!-- Page 44 -->
"The amount shown on line 890 is your charity's estimated disbursement quota requirement for the next fiscal period."

**Source(s):**

- Schedule 8 - Disbursement Quota