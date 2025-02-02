import assert = require("assert");
require("dotenv").config();
import { Client } from "@notionhq/client";
import path = require("path");

import { AppConfig, ItemTypeSetting } from "./app-config-types"
import { DbRecord, PropertyValue, DbRecordsMap, RelationValue } from "./types";
import { InputItem, funcReadInputFile, getDbRecordFromInputItem } from "./input-file"
import { getDatabaseInfo, dumpDb } from "./notion-databases"
import { plainTextToTitleValue, convertToNotionPropertyValue } from "./utilities/notion-api-util"
import { setsDifference, setsIntersection, setsAreEqual } from "./utilities/sets-util"
import { setNotionClient, getNotionClient } from "./notion-client"

import { projectLifeRemindersConfig } from "../projects/life_reminders_config"


function haveTheSameNonRelationPropertiesAndValues(
        record1: DbRecord, record2: DbRecord): boolean {
    const properties1: {[key: string]: PropertyValue} = record1.properties;
    const properties2: {[key: string]: PropertyValue} = record2.properties;

    if (Object.keys(properties1).length !== Object.keys(properties2).length)
        return false;

    for (const propertyName in properties1) {
        if (!(propertyName in properties2))
            return false;
    }

    for (const propertyName in properties1) {
        if (properties1[propertyName] !== properties2[propertyName])
            return false;
    }

    return true;
}


function haveTheSameRelationPropertiesAndValues(
        record1: DbRecord, record2: DbRecord): boolean {
    const properties1: {[key: string]: Array<RelationValue>} = record1.relationProperties;
    const properties2: {[key: string]: Array<RelationValue>} = record2.relationProperties;

    if (Object.keys(properties1).length !== Object.keys(properties2).length)
        return false;

    for (const propertyName in properties1) {
        if (!(propertyName in properties2))
            return false;
    }

    for (const propertyName in properties1) {
        let pageIds1: Set<string> = new Set();
        for (const value of properties1[propertyName]) {
            assert(value.pageId !== undefined);
            pageIds1.add(value.pageId);
        }

        let pageIds2: Set<string> = new Set();
        for (const value of properties2[propertyName]) {
            assert(value.pageId !== undefined);
            pageIds2.add(value.pageId);
        }

        if (!setsAreEqual(pageIds1, pageIds2))
            return false;
    }

    return true;
}


//====


/**
 * @returns (old-DB-Data, new-DB-data), or null if failed
 */
async function updateNonRelationProperties(
    inputFileDir: string,
    itemTypeSetting: ItemTypeSetting
): Promise<[DbRecordsMap, DbRecordsMap] | null> {
    console.log(`---- item type: ${itemTypeSetting.itemType} ----`)
    
    // read input file
    console.log(`reading input file "${itemTypeSetting.inputFile.fileName}"`)
    const inputFilePath: string = path.join(
        inputFileDir, itemTypeSetting.inputFile.fileName);
    const inputData: Array<InputItem> | null = await funcReadInputFile(inputFilePath);
    if (inputData === null)
        return null;

    // convert input data to DB records (without pageId)
    let newDbData: DbRecordsMap = {};
    for (const item of inputData) {
        const record: DbRecord | null = getDbRecordFromInputItem(
            item, 
            itemTypeSetting.inputFile, 
            itemTypeSetting.propertyNames,
            itemTypeSetting.relations
        );
        if (record === null) 
            return null;

        newDbData[record.itemId] = record;
    }

    // get DB's column names and types
    console.log("getting database info");

    const [dbTitle, columnNameToType] = await getDatabaseInfo(
        itemTypeSetting.notionDatabase.databaseID);

    let propertiesOfSelectType: Set<string> = new Set();
    for (const propertyName of itemTypeSetting.propertyNames) {
        if (!(propertyName in columnNameToType)) {
            console.error(`column \"${propertyName}\" not found in DB`);
            return null;
        }
        if (columnNameToType[propertyName] === "select")
            propertiesOfSelectType.add(propertyName);
    }

    // dump DB 
    console.log(`querying database "${dbTitle}"`);

    const oldDbData: DbRecordsMap | null = await dumpDb(
        itemTypeSetting.notionDatabase, itemTypeSetting.propertyNames, itemTypeSetting.relations); 
    if (oldDbData === null)
        return;

    // determine pages to create, remove, update
    const oldItemIds = new Set(Object.keys(oldDbData));
    const newItemIds = new Set(Object.keys(newDbData));

    const itemIdsToRemove = setsDifference(oldItemIds, newItemIds);
    const itemIdsToCreate = setsDifference(newItemIds, oldItemIds);

    let itemIdsToUpdate: Set<string> = new Set();
    let itemIdsNoChangeNeeded: Set<string> = new Set();
    const commonItemIds = setsIntersection(oldItemIds, newItemIds);
    for (const itemId of commonItemIds) {
        if (oldDbData[itemId].pageName !== newDbData[itemId].pageName) 
            itemIdsToUpdate.add(itemId);
        else if (!haveTheSameNonRelationPropertiesAndValues(oldDbData[itemId], newDbData[itemId]))
            itemIdsToUpdate.add(itemId);
        else
            itemIdsNoChangeNeeded.add(itemId);
    }

    // create pages
    for (const itemId of itemIdsToCreate) {
        const record: DbRecord = newDbData[itemId];

        let properties = {}
        for (const propertyName in record.properties) {
            const isSelectType = propertiesOfSelectType.has(propertyName);
            const value = convertToNotionPropertyValue(record.properties[propertyName], isSelectType)
            properties[propertyName] = value;
        }

        console.log(
            `+ create page: itemId=${record.itemId}, pageName=\"${record.pageName}\"`);
        const response = await getNotionClient().pages.create({
            parent: {
                "database_id": itemTypeSetting.notionDatabase.databaseID
            },
            properties: {
                Name: plainTextToTitleValue(record.pageName),
                [itemTypeSetting.notionDatabase.propertyNameForItemId]: 
                    convertToNotionPropertyValue(record.itemId),
                ...properties
            }
        });

        // set pageId
        newDbData[itemId].pageId = response.id;
    }

    // remove pages
    for (const itemId of itemIdsToRemove) {
        const record: DbRecord = oldDbData[itemId];
        const pageId = record.pageId;
        assert(pageId !== undefined);

        console.log(
            `+ move page to trash: itemId=${record.itemId}, pageName=\"${record.pageName}\"`);
        await getNotionClient().pages.update({
            page_id: pageId,
            in_trash: true
        });
    }

    // update pages
    for (const itemId of itemIdsToUpdate) {
        const pageId = oldDbData[itemId].pageId;
        assert(pageId !== undefined);

        //
        const record: DbRecord = newDbData[itemId];

        let newProperties = {}
        for (const propertyName in record.properties) {
            const isSelectType = propertiesOfSelectType.has(propertyName);
            const value = convertToNotionPropertyValue(record.properties[propertyName], isSelectType)
            newProperties[propertyName] = value;
        }

        console.log(
            `+ update page: itemId=${record.itemId}, pageName=\"${record.pageName}\"`);
        await getNotionClient().pages.update({
            page_id: pageId,
            properties: {
                Name: plainTextToTitleValue(record.pageName),
                ...newProperties
            }
        });

        // set pageId
        newDbData[itemId].pageId = pageId;
    }

    //
    for (const itemId of itemIdsNoChangeNeeded) {
        // set pageId
        newDbData[itemId].pageId = oldDbData[itemId].pageId;
    }

    return [oldDbData, newDbData];
}


//====


type OldAndNewDbData = {
    oldDbData: DbRecordsMap,
    newDbData: DbRecordsMap
}


async function updateRelationProperties(
    itemTypeSetting: ItemTypeSetting, 
    itemTypeToData: {[key: string]: OldAndNewDbData}
): Promise<boolean> {
    console.log(`---- item type: ${itemTypeSetting.itemType} ----`)

    if (itemTypeSetting.relations.length === 0) // no relation property
        return true;

    const currentItemType: string = itemTypeSetting.itemType;
    const { oldDbData, newDbData } = itemTypeToData[currentItemType];

    // fill in pageId of values of relation properties in newDbData
    for (const relationSetting of itemTypeSetting.relations) {
        const propertyName: string = relationSetting.propertyName;

        //
        if (!(relationSetting.targetItemType in itemTypeToData)) {
            console.error(
                `input data do not contain item-type ${relationSetting.targetItemType}, `
                + "which is used as the target item-type of a relation");
            return false;
        }
        const dataOfTargetItemType: DbRecordsMap 
            = itemTypeToData[relationSetting.targetItemType].newDbData;

        //
        for (const itemId in newDbData) {
            const relationValues: Array<RelationValue> 
                = newDbData[itemId].relationProperties[propertyName]

            for (const value of relationValues) {
                assert(value.itemId !== undefined);
                if (!(value.itemId in dataOfTargetItemType)) {
                    console.error(
                        `could not find item of type ${relationSetting.targetItemType} ` 
                        + `with ID ${value.itemId}`);
                }
                const pageId = dataOfTargetItemType[value.itemId].pageId;
                assert(pageId !== undefined);
                value.pageId = pageId;
            }
        }
    }

    // determine pages to update
    let itemIdsToUpdate: Set<string> = new Set();
    for (const itemId in newDbData) {
        if (!(itemId in oldDbData)) 
            itemIdsToUpdate.add(itemId);
        else if (!haveTheSameRelationPropertiesAndValues(newDbData[itemId], oldDbData[itemId])) 
            itemIdsToUpdate.add(itemId);
    }

    // update pages
    for (const itemId of itemIdsToUpdate) {
        let notionPropertiesValue = {};
        for (const propertyName in newDbData[itemId].relationProperties) {

            const relationValues: Array<RelationValue> 
                = newDbData[itemId].relationProperties[propertyName];

            let notionRelationArray = [];
            for (const value of relationValues) 
                notionRelationArray.push({ id: value.pageId });

            notionPropertiesValue[propertyName] = { relation: notionRelationArray };
        }

        //
        console.log(
            `+ update page: itemId=${itemId}, pageName=\"${newDbData[itemId].pageName}\"`);
        const pageId: string = newDbData[itemId].pageId;
        await getNotionClient().pages.update({
            page_id: pageId,
            properties: notionPropertiesValue
        })
    }

    return true;
}


//====


async function main(): Promise<number> {
    // projects & configs
    const projectNameToConfig: {[key: string]: AppConfig} = {
        "life_reminders": projectLifeRemindersConfig
    }

    // -- get project name from argument
    const project: string | undefined = process.argv[2];

    const projectNameList: string = Object.keys(projectNameToConfig).join(", ");

    if (project === undefined) {
        console.error(`Please specify project name (${projectNameList})`);
        return 1;
    }
    if (!(project in projectNameToConfig)) {
        console.error(`Project name must be one of [${projectNameList}]`);
        return 1;
    }

    // -- 
    const appConfig: AppConfig = projectNameToConfig[project];

    //
    const notion = new Client({
        auth: process.env[appConfig.notionTokenName],
    });
    setNotionClient(notion);

    // read input data and update DB for non-relation properties
    console.log("==== update non-relation properties ====");

    let itemTypeToData: {[key: string]: OldAndNewDbData} = {}
    for (const itemTypeSetting of appConfig.itemTypes) {
        const result = await updateNonRelationProperties(
            appConfig.inputFileDir, itemTypeSetting);
        if (result === null) 
            return 1;

        const [oldDbData, newDbData] = result;
        itemTypeToData[itemTypeSetting.itemType] = { oldDbData, newDbData }
    }

    // update DB for relation properties
    console.log("\n==== update relation properties ====");

    for (const itemTypeSetting of appConfig.itemTypes) {
        const ok = await updateRelationProperties(itemTypeSetting, itemTypeToData);
        if (!ok) 
            return 1;
    }
}


(async () => {
    process.exitCode = await main();
})()
