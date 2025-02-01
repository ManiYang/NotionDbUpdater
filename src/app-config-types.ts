export type RelationSetting = {
    propertyName: string,
    targetItemType: string
}

export type InputFileSetting = {
    fileName: string,
    keyNameForItemId: string,
    funcGetPageName: (item: any) => string | null
}

export type NotionDatabaseSetting = {
    databaseID: string,
    propertyNameForItemId: string
}

export type ItemTypeSetting = {
    itemType: string,
    propertyNames: Array<string>,
    relations: Array<RelationSetting>,

    inputFile: InputFileSetting,

    notionDatabase: NotionDatabaseSetting
}

export type AppConfig = {
    inputFileDir: string,
    itemTypes: Array<ItemTypeSetting>
}
