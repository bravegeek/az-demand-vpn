@description('Application Insights for application monitoring')
@minLength(1)
@maxLength(63)
param name string

@description('Azure region for resource deployment')
param location string = resourceGroup().location

@description('Tags to apply to the resource')
param tags object = {}

@description('Log Analytics Workspace ID')
param logAnalyticsWorkspaceId string

@description('Application Type')
@allowed(['web', 'other', 'java', 'mobile-center', 'phone', 'store', 'ios', 'nodeJS', 'java-spring-boot'])
param applicationType string = 'web'

@description('Flow Type')
@allowed(['Bluefield'])
param flowType string = 'Bluefield'

@description('Request Source')
@allowed(['rest', 'portal', 'vs', 'xcode', 'appcenter', 'vsstudio', 'ibiza', 'azureportal', 'vscode', 'github', 'appinsights', 'loganalytics', 'azurepowershell', 'azurecli', 'vstest', 'continuouswebjob', 'codeless', 'azuremonitor', 'applicationinsights', 'loganalytics', 'azurepowershell', 'azurecli', 'vstest', 'continuouswebjob', 'codeless', 'azuremonitor'])
param requestSource string = 'rest'

@description('Public Network Access for Ingestion')
@allowed(['Enabled', 'Disabled'])
param publicNetworkAccessForIngestion string = 'Enabled'

@description('Public Network Access for Query')
@allowed(['Enabled', 'Disabled'])
param publicNetworkAccessForQuery string = 'Enabled'

resource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: name
  location: location
  tags: tags
  kind: applicationType
  properties: {
    Application_Type: applicationType
    Flow_Type: flowType
    Request_Source: requestSource
    publicNetworkAccessForIngestion: publicNetworkAccessForIngestion
    publicNetworkAccessForQuery: publicNetworkAccessForQuery
    WorkspaceResourceId: logAnalyticsWorkspaceId
  }
}

output appInsightsId string = applicationInsights.id
output appInsightsName string = applicationInsights.name
output instrumentationKey string = applicationInsights.properties.InstrumentationKey
output connectionString string = applicationInsights.properties.ConnectionString
