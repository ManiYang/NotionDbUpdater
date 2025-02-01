const fs = require("fs").promises;

import { InputFileSetting, RelationSetting } from "./app-config-types";
import { DbRecord, PropertyValue, RelationValue } from "./types";

export type InputItem = { [key: string]: any };


export async function funcReadInputFile(
    inputFilePath: string
): Promise<Array<InputItem> | null> {
    const rawData: string = await fs.readFile(inputFilePath, "utf8");

    let data;
    try {
        data = JSON.parse(rawData);
    } catch (e) {
        if (e instanceof SyntaxError) {
            console.error("input file is not in JSON format");
            return null;
        } else {
            throw e;
        }
    }

    if (!(data instanceof Array)) {
        console.error("input file does not contain an array of objects");
        return null;
    }

    for (const item of data) {
        if (!(item instanceof Object)) {
            console.error("some item in input file is not an object");
            return null;
        }
    }

    return data;
}

export function getDbRecordFromInputItem(
    item: InputItem,
    inputFileSetting: InputFileSetting,
    propertyNames: Array<string>,
    relationsSetting: Array<RelationSetting>
): DbRecord | null {
    // pageName
    const pageName: string | null = inputFileSetting.funcGetPageName(item);
    if (pageName === null) {
        console.error(`could not get pageName for an item in input file`);
        return null;
    }

    // properties
    let properties: { [key: string]: PropertyValue } = {};
    for (const propertyName of propertyNames) {
        if (!(propertyName in item)) {
            console.error(
                `an item in input file does not has key ${propertyName}`
            );
            return null;
        }

        if (
            typeof item[propertyName] !== "boolean" &&
            typeof item[propertyName] !== "number" &&
            typeof item[propertyName] !== "string"
        ) {
            console.error(
                `an item in input file has value of unsupported type for key ${propertyName}`
            );
            return null;
        }

        properties[propertyName] = item[propertyName];
    }
    
    // relations
    let relations: {[key: string]: Array<RelationValue>} = {};
    for (const relationSetting of relationsSetting) {
        if (!(relationSetting.propertyName in item)) {
            console.error(
                `an item in input file does not has key ${relationSetting.propertyName}`
            );
            return null;
        }

        if (!(item[relationSetting.propertyName] instanceof Array)) {
            console.error(
                `an item in input file does not has array value for key ${relationSetting.propertyName}`
            );
            return null;
        }

        let relationValues: Array<RelationValue> = []
        for (const itemId of item[relationSetting.propertyName]) 
            relationValues.push({ itemId: itemId });

        relations[relationSetting.propertyName] = relationValues;
    }

    //
    return {
        itemId: item.id,
        pageName,
        properties,
        relationProperties: relations
    };
}
