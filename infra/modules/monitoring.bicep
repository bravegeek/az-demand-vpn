@description('Monitoring and alerting for VPN solution')
param location string = resourceGroup().location

@description('Tags to apply to the resource')
param tags object = {}

@description('Log Analytics Workspace ID')
param logAnalyticsWorkspaceId string

@description('Function App ID')
param functionAppId string

@description('VPN Container ID')
param vpnContainerId string

@description('Enable monitoring alerts')
param enableAlerts bool = true

@description('Enable cost alerts')
param enableCostAlerts bool = true

@description('Alert email addresses')
param alertEmails array = []

// Action Group for alerts
resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = if (enableAlerts) {
  name: 'vpn-alerts-ag'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'VPNAlerts'
    enabled: true
    emailReceivers: [
      for email in alertEmails: {
        name: 'email-${indexOf(alertEmails, email)}'
        emailAddress: email
        useCommonAlertSchema: true
      }
    ]
    smsReceivers: []
    webhookReceivers: []
    itsmReceivers: []
    azureAppPushReceivers: []
    voiceReceivers: []
    logicAppReceivers: []
    azureFunctionReceivers: []
    armRoleReceivers: []
  }
}

// VPN Container Health Alert
resource vpnHealthAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (enableAlerts) {
  name: 'vpn-container-health'
  location: 'global'
  tags: tags
  properties: {
    description: 'Alert when VPN container is unhealthy'
    severity: 2
    enabled: true
    scopes: [
      vpnContainerId
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'High CPU Usage'
          metricName: 'CpuPercentage'
          operator: 'GreaterThan'
          threshold: 80
          timeAggregation: 'Average'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [
      {
        actionGroupId: actionGroup.id
        webhookProperties: {}
      }
    ]
  }
}

// Function App Error Alert
resource functionErrorAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (enableAlerts) {
  name: 'function-app-errors'
  location: 'global'
  tags: tags
  properties: {
    description: 'Alert when Function App has errors'
    severity: 2
    enabled: true
    scopes: [
      functionAppId
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'High Error Rate'
          metricName: 'Http5xx'
          operator: 'GreaterThan'
          threshold: 5
          timeAggregation: 'Total'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [
      {
        actionGroupId: actionGroup.id
        webhookProperties: {}
      }
    ]
  }
}

// Cost Alert
resource costAlert 'Microsoft.Consumption/budgets@2021-10-01' = if (enableCostAlerts) {
  name: 'vpn-cost-budget'
  properties: {
    category: 'Cost'
    amount: 100
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: '2024-01-01T00:00:00Z'
      endDate: '2024-12-31T23:59:59Z'
    }
    notifications: {
      actualThreshold: 100
      forecastThreshold: 90
      operator: 'GreaterThan'
      contactEmails: alertEmails
      contactRoles: []
      contactGroups: []
      thresholdType: 'Actual'
    }
  }
}

// Log Analytics Query Alert for VPN Connections
resource vpnConnectionAlert 'Microsoft.Insights/scheduledQueryRules@2023-09-01' = if (enableAlerts) {
  name: 'vpn-connection-alert'
  location: location
  tags: tags
  properties: {
    description: 'Alert when VPN connection count is high'
    enabled: true
    evaluationFrequency: 'PT5M'
    scopes: [
      logAnalyticsWorkspaceId
    ]
    severity: 2
    query: 'ContainerInstanceLog_CL | where ContainerName_s == "vpn-server" | where Log_s contains "connection established" | count'
    queryType: 'ResultCount'
    timeWindow: 'PT5M'
    criteria: {
      allOf: [
        {
          query: 'ContainerInstanceLog_CL | where ContainerName_s == "vpn-server" | where Log_s contains "connection established" | count'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 50
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: [
        actionGroup.id
      ]
    }
  }
}

output actionGroupId string = actionGroup.id
output actionGroupName string = actionGroup.name
