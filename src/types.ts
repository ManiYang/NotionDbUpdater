
export type PropertyValue = boolean | number | string;

export type RelationValue = {
    pageId?: string,
    itemId?: string
}

export type DbRecord = {
    itemId: number,
    pageId?: string,
    pageName: string,
    properties: {[key: string]: PropertyValue}, // keys are non-relation property names
    relationProperties: {[key: string]: Array<RelationValue>} // keys are relation property names
};

export type DbRecordsMap = {[key: number]: DbRecord} // keys are item IDs
