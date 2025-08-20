import React, { useState, useEffect } from "react";
import { actionGroupAPI } from "../utils/api";

const ActionGroupPage = () => {
  const [apiConfig, setApiConfig] = useState({
    apiName: "",
    description: "",
    baseUrl: "",
    endpoints: [],
    authentication: {
      type: "none",
      location: "header",
      name: "",
      value: "",
    },
  });

  const [currentEndpoint, setCurrentEndpoint] = useState({
    path: "",
    method: "GET",
    description: "",
    parameters: [],
    responseExample: "",
  });

  const [currentParameter, setCurrentParameter] = useState({
    name: "",
    type: "string",
    location: "path", // Changed default to 'path' since most APIs use path parameters
    required: false,
    description: "",
  });

  const [agentInfo, setAgentInfo] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [creationResult, setCreationResult] = useState(null);
  const [existingActionGroups, setExistingActionGroups] = useState([]);
  const [activeTab, setActiveTab] = useState("create");
  const [editingActionGroup, setEditingActionGroup] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(null); // Track which action group is being deleted
  const [aliasName, setAliasName] = useState("");
  const [aliasError, setAliasError] = useState("");
  const [isToggling, setIsToggling] = useState(null);

  useEffect(() => {
    loadAgentInfo();
    loadExistingActionGroups();
  }, []);

  const loadAgentInfo = async () => {
    try {
      const response = await actionGroupAPI.getAgentInfo();
      if (response.success) {
        setAgentInfo(response.data.agent);
      }
    } catch (error) {
      console.error("Failed to load agent info:", error);
    }
  };

  const loadExistingActionGroups = async () => {
    try {
      const response = await actionGroupAPI.listActionGroups();
      if (response.success) {
        setExistingActionGroups(response.data.actionGroups);
      }
    } catch (error) {
      console.error("Failed to load action groups:", error);
    }
  };

  const addParameter = () => {
    if (currentParameter.name.trim()) {
      setCurrentEndpoint({
        ...currentEndpoint,
        parameters: [...currentEndpoint.parameters, { ...currentParameter }],
      });
      setCurrentParameter({
        name: "",
        type: "string",
        location: "path", // Keep this improvement
        required: false,
        description: "",
      });
    }
  };

  const removeParameter = (index) => {
    setCurrentEndpoint({
      ...currentEndpoint,
      parameters: currentEndpoint.parameters.filter((_, i) => i !== index),
    });
  };

  const addEndpoint = () => {
    if (currentEndpoint.path.trim() && currentEndpoint.description.trim()) {
      setApiConfig({
        ...apiConfig,
        endpoints: [...apiConfig.endpoints, { ...currentEndpoint }],
      });
      setCurrentEndpoint({
        path: "",
        method: "GET",
        description: "",
        parameters: [],
        responseExample: "",
      });
    }
  };

  const removeEndpoint = (index) => {
    setApiConfig({
      ...apiConfig,
      endpoints: apiConfig.endpoints.filter((_, i) => i !== index),
    });
  };

  const validateConfiguration = () => {
    const errors = [];

    if (!apiConfig.apiName.trim()) errors.push("API Name is required");
    if (!apiConfig.baseUrl.trim()) errors.push("Base URL is required");
    if (apiConfig.endpoints.length === 0)
      errors.push("At least one endpoint is required");

    try {
      new URL(apiConfig.baseUrl);
    } catch (e) {
      errors.push("Invalid Base URL format");
    }

    apiConfig.endpoints.forEach((endpoint, index) => {
      if (!endpoint.path.trim())
        errors.push(`Endpoint ${index + 1}: Path is required`);
      if (!endpoint.description.trim())
        errors.push(`Endpoint ${index + 1}: Description is required`);

      if (endpoint.responseExample) {
        try {
          JSON.parse(endpoint.responseExample);
        } catch (e) {
          errors.push(
            `Endpoint ${index + 1}: Invalid JSON in response example`
          );
        }
      }
    });

    return errors;
  };

  // Alias validation function
  const validateAliasName = (name) => {
    if (!name) return "Alias name is required";
    if (name.length > 100) return "Alias name must be at most 100 characters";
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return "Only a-z, A-Z, 0-9, _ (underscore), and - (hyphen) are allowed";
    }
    return "";
  };

  const handleCreateActionGroup = async () => {
    const validationErrors = validateConfiguration();

    // Alias validation
    const aliasValidation = validateAliasName(aliasName);
    if (aliasValidation) {
      setAliasError(aliasValidation);
      validationErrors.push("Alias name: " + aliasValidation);
    } else {
      setAliasError("");
    }

    if (validationErrors.length > 0) {
      alert("Please fix the following errors:\n" + validationErrors.join("\n"));
      return;
    }

    setIsCreating(true);
    setCreationResult(null);

    try {
      // Pass aliasName to backend
      const response = await actionGroupAPI.createActionGroup({
        ...apiConfig,
        aliasName: aliasName.trim(),
      });

      if (response.success) {
        setCreationResult({
          success: true,
          message: "Action Group created successfully!",
          data: response.data,
        });
        await loadExistingActionGroups();
        // Reset form
        setApiConfig({
          apiName: "",
          description: "",
          baseUrl: "",
          endpoints: [],
          authentication: {
            type: "none",
            location: "header",
            name: "",
            value: "",
          },
        });
        setAliasName("");
        setAliasError("");
      } else {
        setCreationResult({
          success: false,
          message: response.error || "Failed to create action group",
        });
      }
    } catch (error) {
      setCreationResult({
        success: false,
        message:
          error.message || "An error occurred while creating the action group",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleTestActionGroup = async (actionGroupId) => {
    try {
      const response = await actionGroupAPI.testActionGroup(actionGroupId);
      alert(
        response.success ? "Test successful!" : "Test failed: " + response.error
      );
    } catch (error) {
      alert("Test failed: " + error.message);
    }
  };

//  handleToggleActionGroup function 
const handleToggleActionGroup = async (actionGroupId, currentState) => {
  // Prevent multiple simultaneous operations
  if (isToggling) {
    console.log("Another operation in progress, skipping...");
    return;
  }

  setIsToggling(actionGroupId);
  
  try {
    let response;
    const isCurrentlyEnabled = currentState === "ENABLED";
    
    console.log(`Action Group: ${actionGroupId}, Current State: ${currentState}`);
    
    if (isCurrentlyEnabled) {
      console.log(`Disabling action group: ${actionGroupId}`);
      // FIXED: Back to using API utility (which now calls correct endpoint)
      response = await actionGroupAPI.disableActionGroup(actionGroupId);
    } else {
      console.log(`Enabling action group: ${actionGroupId}`);
      // FIXED: Back to using API utility (which now calls correct endpoint)
      response = await actionGroupAPI.enableActionGroup(actionGroupId);
    }

    console.log("API Response:", response);

    if (response && response.success) {
      // Wait a moment for AWS changes to propagate
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Refresh the action groups list to reflect changes
      await loadExistingActionGroups();
      
      const action = isCurrentlyEnabled ? "disabled" : "enabled";
      const message = isCurrentlyEnabled 
        ? "Action group disabled successfully" 
        : "Action group enabled successfully (others disabled)";
      
      alert(message);
    } else {
      throw new Error(response?.error || response?.message || "Unknown error occurred");
    }
  } catch (error) {
    console.error("Toggle action group error:", error);
    
    let errorMessage = `Failed to ${currentState === "ENABLED" ? "disable" : "enable"} action group: `;
    
    // Handle different types of errors
    if (error.response?.status === 404) {
      errorMessage += "Action group not found. It may have been deleted.";
      // Refresh the list to remove stale entries
      await loadExistingActionGroups();
    } else if (error.response?.data?.message) {
      errorMessage += error.response.data.message;
    } else if (error.response?.data?.error) {
      errorMessage += error.response.data.error;
    } else if (error.message) {
      errorMessage += error.message;
    } else {
      errorMessage += "Unknown error occurred";
    }
    
    alert(errorMessage);
    
    // Refresh the list anyway to get current state
    try {
      await loadExistingActionGroups();
    } catch (refreshError) {
      console.error("Failed to refresh action groups list:", refreshError);
    }
  } finally {
    setIsToggling(null);
  }
};

  const handleDeleteActionGroup = async (actionGroupId) => {
    const actionGroup = existingActionGroups.find(
      (ag) => ag.actionGroupId === actionGroupId
    );
    const isEnabled = actionGroup?.actionGroupState === "ENABLED";

    let confirmMessage =
      " Are you sure you want to PERMANENTLY DELETE this action group?";
    confirmMessage += "\n\n This action cannot be undone!";
    confirmMessage += `\n📝 Action Group: ${
      actionGroup?.actionGroupName || actionGroupId
    }`;
    if (isEnabled) {
      confirmMessage +=
        "\n\n🔴 Note: This action group is currently ENABLED and will be automatically disabled before deletion.";
    }

    if (confirm(confirmMessage)) {
      setIsDeleting(actionGroupId);
      try {
        await actionGroupAPI.deleteActionGroup(actionGroupId);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await loadExistingActionGroups();
        alert("🎉 Action group deleted successfully!");
      } catch (error) {
        let errorMessage = "❌ Error deleting action group: ";
        if (error.response?.data?.message) {
          errorMessage += error.response.data.message;
        } else if (error.response?.data?.error) {
          errorMessage += error.response.data.error;
        } else if (error.message) {
          errorMessage += error.message;
        } else {
          errorMessage += "Unknown error occurred";
        }
        alert(errorMessage);
      } finally {
        setIsDeleting(null);
      }
    }
  };

  const handleEditActionGroup = async (actionGroupId) => {
    try {
      const response = await actionGroupAPI.getActionGroup(actionGroupId);
      if (response.success) {
        setEditingActionGroup(response.data);
        setIsEditing(true);
        setActiveTab("create"); // Switch to create tab for editing

        // Populate the form with existing data
        // Note: This is a simplified version - you might need to parse the OpenAPI schema
        // to reconstruct the original API configuration
        alert(
          "Edit functionality will be available in the next update. For now, you can create a new action group with updated configuration."
        );
      } else {
        alert("Failed to load action group details: " + response.error);
      }
    } catch (error) {
      alert("Error loading action group: " + error.message);
    }
  };

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">
          Action Group Management
        </h1>
        <p className="text-gray-600 mt-2">
          Create and manage automated action groups for your Bedrock agent
        </p>
      </div>

      {/* Agent Info Card */}
      {agentInfo && (
        <div className="card mb-6 bg-blue-50 border-blue-200">
          <div className="p-4">
            <h3 className="font-semibold text-blue-900">Agent Information</h3>
            <div className="grid grid-cols-2 gap-4 mt-2 text-sm">
              <div>
                <span className="font-medium">Agent ID:</span>{" "}
                {agentInfo.agentId}
              </div>
              <div>
                <span className="font-medium">Status:</span>
                <span
                  className={`ml-2 px-2 py-1 rounded text-xs ${
                    agentInfo.status === "PREPARED"
                      ? "bg-green-100 text-green-800"
                      : "bg-yellow-100 text-yellow-800"
                  }`}
                >
                  {agentInfo.status}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex space-x-1 mb-6">
        <button
          onClick={() => setActiveTab("create")}
          className={`px-4 py-2 rounded-t-lg font-medium ${
            activeTab === "create"
              ? "bg-white border-t border-l border-r border-gray-300 text-blue-600"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          Create Action Group
        </button>
        <button
          onClick={() => setActiveTab("manage")}
          className={`px-4 py-2 rounded-t-lg font-medium ${
            activeTab === "manage"
              ? "bg-white border-t border-l border-r border-gray-300 text-blue-600"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          Manage Action Groups ({existingActionGroups.length})
        </button>
      </div>

      {activeTab === "create" && (
        <div className="space-y-6">
          {/* Step-by-step Guide */}
          <div className="card bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
            <div className="p-6">
              <h2 className="text-xl font-semibold mb-4 text-blue-800">
                📋 Step-by-Step Guide
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-xs">
                    1
                  </div>
                  <div>
                    <div className="font-medium text-blue-800">
                      Configure API
                    </div>
                    <div className="text-gray-600">
                      Enter API name, base URL, and description
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-xs">
                    2
                  </div>
                  <div>
                    <div className="font-medium text-blue-800">
                      Add Endpoints
                    </div>
                    <div className="text-gray-600">
                      Create endpoints, add parameters, then click "Add
                      Endpoint"
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-xs">
                    3
                  </div>
                  <div>
                    <div className="font-medium text-blue-800">
                      Create Action Group
                    </div>
                    <div className="text-gray-600">
                      Review your configuration and create the action group
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* API Configuration Form */}
          <div className="card">
            <div className="p-6">
              <h2 className="text-xl font-semibold mb-4">
                Step 1: API Configuration
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    API Name *
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    value={apiConfig.apiName}
                    onChange={(e) =>
                      setApiConfig({ ...apiConfig, apiName: e.target.value })
                    }
                    placeholder="e.g., Order Tracking API"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Base URL *
                  </label>
                  <input
                    type="url"
                    className="input-field"
                    value={apiConfig.baseUrl}
                    onChange={(e) =>
                      setApiConfig({ ...apiConfig, baseUrl: e.target.value })
                    }
                    placeholder="https://api.example.com"
                  />
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </label>
                <textarea
                  className="input-field"
                  rows="3"
                  value={apiConfig.description}
                  onChange={(e) =>
                    setApiConfig({ ...apiConfig, description: e.target.value })
                  }
                  placeholder="Describe what this API does..."
                />
              </div>

              {/* Authentication Configuration */}
              <div className="border-t pt-4">
                <h3 className="text-lg font-medium mb-3">Authentication</h3>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Type
                    </label>
                    <select
                      className="input-field"
                      value={apiConfig.authentication.type}
                      onChange={(e) =>
                        setApiConfig({
                          ...apiConfig,
                          authentication: {
                            ...apiConfig.authentication,
                            type: e.target.value,
                          },
                        })
                      }
                    >
                      <option value="none">None</option>
                      <option value="apiKey">API Key</option>
                      <option value="bearer">Bearer Token</option>
                      <option value="basic">Basic Auth</option>
                    </select>
                  </div>

                  {apiConfig.authentication.type !== "none" && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Location
                        </label>
                        <select
                          className="input-field"
                          value={apiConfig.authentication.location}
                          onChange={(e) =>
                            setApiConfig({
                              ...apiConfig,
                              authentication: {
                                ...apiConfig.authentication,
                                location: e.target.value,
                              },
                            })
                          }
                        >
                          <option value="header">Header</option>
                          <option value="query">Query Parameter</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Name
                        </label>
                        <input
                          type="text"
                          className="input-field"
                          value={apiConfig.authentication.name}
                          onChange={(e) =>
                            setApiConfig({
                              ...apiConfig,
                              authentication: {
                                ...apiConfig.authentication,
                                name: e.target.value,
                              },
                            })
                          }
                          placeholder="X-API-Key, Authorization, etc."
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Value
                        </label>
                        <input
                          type="password"
                          className="input-field"
                          value={apiConfig.authentication.value}
                          onChange={(e) =>
                            setApiConfig({
                              ...apiConfig,
                              authentication: {
                                ...apiConfig.authentication,
                                value: e.target.value,
                              },
                            })
                          }
                          placeholder="API key or token"
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Endpoint Configuration */}
          <div className="card">
            <div className="p-6">
              <h2 className="text-xl font-semibold mb-4">
                Step 2: Endpoints Configuration
              </h2>

              {/* Add New Endpoint Form */}
              <div className="border border-gray-200 rounded-lg p-4 mb-4 bg-gray-50">
                <h3 className="font-medium mb-3">Add New Endpoint</h3>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Method
                    </label>
                    <select
                      className="input-field"
                      value={currentEndpoint.method}
                      onChange={(e) =>
                        setCurrentEndpoint({
                          ...currentEndpoint,
                          method: e.target.value,
                        })
                      }
                    >
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                      <option value="PUT">PUT</option>
                      <option value="DELETE">DELETE</option>
                      <option value="PATCH">PATCH</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Path *
                    </label>
                    <input
                      type="text"
                      className="input-field"
                      value={currentEndpoint.path}
                      onChange={(e) =>
                        setCurrentEndpoint({
                          ...currentEndpoint,
                          path: e.target.value,
                        })
                      }
                      placeholder="/orders/{orderId}"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Description *
                    </label>
                    <input
                      type="text"
                      className="input-field"
                      value={currentEndpoint.description}
                      onChange={(e) =>
                        setCurrentEndpoint({
                          ...currentEndpoint,
                          description: e.target.value,
                        })
                      }
                      placeholder="Get order by ID"
                    />
                  </div>
                </div>

                {/* Parameters Section */}
                <div className="mb-4">
                  <h4 className="font-medium mb-2">Parameters</h4>

                  {/* Add Parameter Form */}
                  <div className="border-2 border-dashed border-blue-200 rounded-lg p-4 bg-blue-50">
                    <div className="flex items-center justify-between mb-3">
                      <h5 className="font-medium text-blue-800">
                        Add Parameter
                      </h5>
                      {currentEndpoint.path.includes("{") &&
                        currentEndpoint.path.includes("}") && (
                          <span className="text-sm text-orange-600 bg-orange-100 px-2 py-1 rounded">
                            ⚠️ Path parameters detected in URL
                          </span>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-6 gap-2 mb-3">
                      <input
                        type="text"
                        className="input-field"
                        placeholder="Parameter name"
                        value={currentParameter.name}
                        onChange={(e) =>
                          setCurrentParameter({
                            ...currentParameter,
                            name: e.target.value,
                          })
                        }
                      />

                      <select
                        className="input-field"
                        value={currentParameter.type}
                        onChange={(e) =>
                          setCurrentParameter({
                            ...currentParameter,
                            type: e.target.value,
                          })
                        }
                      >
                        <option value="string">String</option>
                        <option value="integer">Integer</option>
                        <option value="number">Number</option>
                        <option value="boolean">Boolean</option>
                      </select>

                      <select
                        className="input-field"
                        value={currentParameter.location}
                        onChange={(e) =>
                          setCurrentParameter({
                            ...currentParameter,
                            location: e.target.value,
                          })
                        }
                      >
                        <option value="path">Path</option>
                        <option value="query">Query</option>
                        <option value="header">Header</option>
                      </select>

                      <input
                        type="text"
                        className="input-field"
                        placeholder="Description"
                        value={currentParameter.description}
                        onChange={(e) =>
                          setCurrentParameter({
                            ...currentParameter,
                            description: e.target.value,
                          })
                        }
                      />

                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={currentParameter.required}
                          onChange={(e) =>
                            setCurrentParameter({
                              ...currentParameter,
                              required: e.target.checked,
                            })
                          }
                          className="mr-2"
                        />
                        Required
                      </label>

                      <button
                        type="button"
                        onClick={addParameter}
                        disabled={!currentParameter.name.trim()}
                        className={`px-4 py-2 rounded font-medium transition-colors ${
                          currentParameter.name.trim()
                            ? "bg-blue-600 text-white hover:bg-blue-700"
                            : "bg-gray-300 text-gray-500 cursor-not-allowed"
                        }`}
                      >
                        + Add Parameter
                      </button>
                    </div>

                    {currentParameter.name.trim() && (
                      <div className="text-sm text-blue-600 mb-2">
                        💡 Click "Add Parameter" to save this parameter, then
                        add more if needed
                      </div>
                    )}
                  </div>

                  {/* Parameters List */}
                  {currentEndpoint.parameters.length > 0 ? (
                    <div className="mt-4">
                      <div className="flex items-center gap-2 mb-2">
                        <h5 className="font-medium text-green-700">
                          ✅ Added Parameters (
                          {currentEndpoint.parameters.length})
                        </h5>
                      </div>
                      <div className="space-y-2">
                        {currentEndpoint.parameters.map((param, index) => (
                          <div
                            key={index}
                            className="flex items-center justify-between bg-green-50 border border-green-200 p-3 rounded"
                          >
                            <span className="text-sm">
                              <span className="font-medium text-green-800">
                                {param.name}
                              </span>
                              <span className="ml-2 px-2 py-1 bg-green-100 text-green-700 rounded text-xs">
                                {param.type} • {param.location}
                              </span>
                              {param.required && (
                                <span className="text-red-500 ml-1">*</span>
                              )}
                              {param.description && (
                                <span className="text-gray-600 ml-2">
                                  - {param.description}
                                </span>
                              )}
                            </span>
                            <button
                              onClick={() => removeParameter(index)}
                              className="text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
                      <div className="text-sm text-yellow-700">
                        ℹ️ No parameters added yet.
                        {currentEndpoint.path.includes("{") &&
                          currentEndpoint.path.includes("}") && (
                            <span className="font-medium">
                              {" "}
                              Your URL path contains parameters - make sure to
                              add them above!
                            </span>
                          )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Response Example */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Response Example (JSON)
                  </label>
                  <textarea
                    className="input-field font-mono text-sm"
                    rows="4"
                    value={currentEndpoint.responseExample}
                    onChange={(e) =>
                      setCurrentEndpoint({
                        ...currentEndpoint,
                        responseExample: e.target.value,
                      })
                    }
                    placeholder='{"orderId": "12345", "status": "shipped"}'
                  />
                </div>

                <div className="flex flex-col gap-2">
                  {/* Add validation warning if path has parameters but none are defined */}
                  {currentEndpoint.path.includes("{") &&
                    currentEndpoint.path.includes("}") &&
                    !currentEndpoint.parameters.some(
                      (p) => p.location === "path"
                    ) && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded">
                        <div className="text-sm text-red-700">
                          ⚠️ <strong>Warning:</strong> Your URL path contains
                          parameters (e.g.,{" "}
                          {currentEndpoint.path.match(/\{[^}]+\}/g)?.join(", ")}
                          ) but no path parameters are defined. Make sure to add
                          them above before creating the endpoint.
                        </div>
                      </div>
                    )}

                  <button
                    type="button"
                    onClick={addEndpoint}
                    disabled={
                      !currentEndpoint.path.trim() ||
                      !currentEndpoint.description.trim()
                    }
                    className={`px-6 py-3 rounded font-medium transition-colors ${
                      currentEndpoint.path.trim() &&
                      currentEndpoint.description.trim()
                        ? "bg-green-600 text-white hover:bg-green-700"
                        : "bg-gray-300 text-gray-500 cursor-not-allowed"
                    }`}
                  >
                    ✅ Add Endpoint
                    {currentEndpoint.parameters.length > 0 && (
                      <span className="ml-2 px-2 py-1 bg-green-500 text-green-100 rounded text-sm">
                        {currentEndpoint.parameters.length} param
                        {currentEndpoint.parameters.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* Endpoints List */}
              {apiConfig.endpoints.length > 0 && (
                <div className="space-y-3">
                  <h3 className="font-medium text-green-700">
                    ✅ Configured Endpoints ({apiConfig.endpoints.length})
                  </h3>
                  {apiConfig.endpoints.map((endpoint, index) => (
                    <div
                      key={index}
                      className="border border-green-200 rounded-lg p-4 bg-green-50"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="inline-block bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm font-medium">
                            {endpoint.method}
                          </span>
                          <span className="font-medium">{endpoint.path}</span>
                          {endpoint.parameters.length > 0 && (
                            <span className="inline-block bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-medium">
                              {endpoint.parameters.length} param
                              {endpoint.parameters.length !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => removeEndpoint(index)}
                          className="text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50"
                        >
                          Remove
                        </button>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">
                        {endpoint.description}
                      </p>
                      {endpoint.parameters.length > 0 ? (
                        <div className="text-xs">
                          <span className="text-gray-500">Parameters: </span>
                          {endpoint.parameters.map((p, i) => (
                            <span
                              key={i}
                              className="inline-block bg-gray-100 text-gray-700 px-2 py-1 rounded mr-1 mb-1"
                            >
                              {p.name} ({p.location})
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-yellow-600 bg-yellow-100 px-2 py-1 rounded">
                          ⚠️ No parameters defined
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Create Action Group Button */}
          <div className="card">
            <div className="p-6">
              <h2 className="text-xl font-semibold mb-4">
                Step 3: Create Action Group
              </h2>
              {/* Progress Summary */}
              <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h3 className="font-semibold text-blue-800 mb-2">
                  Configuration Summary
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="font-medium">API Name:</span>
                    <div
                      className={
                        apiConfig.apiName.trim()
                          ? "text-green-600"
                          : "text-red-500"
                      }
                    >
                      {apiConfig.apiName.trim()
                        ? `✅ ${apiConfig.apiName}`
                        : "❌ Not set"}
                    </div>
                  </div>
                  <div>
                    <span className="font-medium">Base URL:</span>
                    <div
                      className={
                        apiConfig.baseUrl.trim()
                          ? "text-green-600"
                          : "text-red-500"
                      }
                    >
                      {apiConfig.baseUrl.trim()
                        ? `✅ ${apiConfig.baseUrl}`
                        : "❌ Not set"}
                    </div>
                  </div>
                  <div>
                    <span className="font-medium">Endpoints:</span>
                    <div
                      className={
                        apiConfig.endpoints.length > 0
                          ? "text-green-600"
                          : "text-red-500"
                      }
                    >
                      {apiConfig.endpoints.length > 0
                        ? `✅ ${apiConfig.endpoints.length} endpoint${
                            apiConfig.endpoints.length !== 1 ? "s" : ""
                          }`
                        : "❌ No endpoints"}
                    </div>
                  </div>
                </div>

                {/* Parameters summary */}
                {apiConfig.endpoints.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-blue-200">
                    <span className="font-medium text-sm">
                      Parameters Summary:
                    </span>
                    <div className="text-sm text-gray-600 mt-1">
                      {apiConfig.endpoints.map((endpoint, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <span className="font-medium">
                            {endpoint.method} {endpoint.path}:
                          </span>
                          <span
                            className={
                              endpoint.parameters.length > 0
                                ? "text-green-600"
                                : "text-yellow-600"
                            }
                          >
                            {endpoint.parameters.length > 0
                              ? `${endpoint.parameters.length} parameter${
                                  endpoint.parameters.length !== 1 ? "s" : ""
                                }`
                              : "No parameters"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Alias Name Input */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Alias name
                </label>
                <input
                  type="text"
                  className={`input-field ${
                    aliasError ? "border-red-500" : ""
                  }`}
                  placeholder="Enter a unique name for your alias"
                  value={aliasName}
                  maxLength={100}
                  onChange={(e) => {
                    setAliasName(e.target.value);
                    setAliasError(validateAliasName(e.target.value));
                  }}
                  autoComplete="off"
                />
                <div className="text-xs text-gray-500 mt-1">
                  Valid characters are a-z, A-Z, 0-9, _ (underscore) and -
                  (hyphen). The name can have up to 100 characters.
                </div>
                {aliasError && (
                  <div className="text-xs text-red-600 mt-1">{aliasError}</div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">
                    Ready to Create Action Group?
                  </h3>
                  <p className="text-sm text-gray-600">
                    This will automatically generate OpenAPI schema and create
                    the action group in AWS Bedrock.
                  </p>
                </div>
                <button
                  onClick={handleCreateActionGroup}
                  disabled={
                    isCreating ||
                    !agentInfo ||
                    apiConfig.endpoints.length === 0 ||
                    !!aliasError ||
                    !aliasName
                  }
                  className={`px-6 py-3 rounded font-medium transition-colors ${
                    !isCreating &&
                    agentInfo &&
                    apiConfig.endpoints.length > 0 &&
                    !aliasError &&
                    aliasName
                      ? "bg-blue-600 text-white hover:bg-blue-700"
                      : "bg-gray-300 text-gray-500 cursor-not-allowed"
                  }`}
                >
                  {isCreating ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                          fill="none"
                        />
                        <path
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      Creating...
                    </span>
                  ) : (
                    "🚀 Create Action Group"
                  )}
                </button>
              </div>

              {creationResult && (
                <div
                  className={`mt-4 p-4 rounded-lg ${
                    creationResult.success
                      ? "bg-green-50 border border-green-200 text-green-800"
                      : "bg-red-50 border border-red-200 text-red-800"
                  }`}
                >
                  <p className="font-medium">{creationResult.message}</p>
                  {creationResult.success && creationResult.data && (
                    <div className="mt-2 text-sm">
                      <p>
                        Action Group ID: {creationResult.data.actionGroupId}
                      </p>
                      <p>Status: {creationResult.data.status}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "manage" && (
        <div className="card">
          <div className="p-6">
            <h2 className="text-xl font-semibold mb-4">
              Existing Action Groups
            </h2>

            {existingActionGroups.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>
                  No action groups found. Create your first one using the form
                  above.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {existingActionGroups.map((actionGroup) => (
                  <div
                    key={actionGroup.actionGroupId}
                    className="border border-gray-200 rounded-lg p-4"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <h3 className="font-semibold">
                          {actionGroup.actionGroupName}
                        </h3>
                        <p className="text-sm text-gray-600">
                          {actionGroup.description}
                        </p>
                      </div>
                      <div className="flex space-x-2">
                        <button
                          onClick={() =>
                            handleToggleActionGroup(
                              actionGroup.actionGroupId,
                              actionGroup.actionGroupState
                            )
                          }
                          disabled={isToggling === actionGroup.actionGroupId}
                          className={`px-3 py-1 rounded text-sm font-medium ${
                            isToggling === actionGroup.actionGroupId
                              ? "bg-gray-400 text-gray-600 cursor-not-allowed"
                              : actionGroup.actionGroupState === "ENABLED"
                              ? "bg-orange-500 text-white hover:bg-orange-600"
                              : "bg-green-500 text-white hover:bg-green-600"
                          }`}
                        >
                          {isToggling === actionGroup.actionGroupId
                            ? "Processing..."
                            : actionGroup.actionGroupState === "ENABLED"
                            ? "Disable"
                            : "Enable"}
                        </button>
                        <button
                          onClick={() =>
                            handleTestActionGroup(actionGroup.actionGroupId)
                          }
                          className="btn-secondary text-sm"
                        >
                          Test
                        </button>
                        <button
                          onClick={() =>
                            handleEditActionGroup(actionGroup.actionGroupId)
                          }
                          className="bg-blue-500 text-white px-3 py-1 rounded text-sm hover:bg-blue-600"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() =>
                            handleDeleteActionGroup(actionGroup.actionGroupId)
                          }
                          disabled={isDeleting === actionGroup.actionGroupId}
                          className={`px-3 py-1 rounded text-sm ${
                            isDeleting === actionGroup.actionGroupId
                              ? "bg-gray-400 text-gray-600 cursor-not-allowed"
                              : "bg-red-500 text-white hover:bg-red-600"
                          }`}
                        >
                          {isDeleting === actionGroup.actionGroupId
                            ? "Deleting..."
                            : "Delete"}
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="font-medium">Status:</span>
                        <span
                          className={`ml-2 px-2 py-1 rounded text-xs ${
                            actionGroup.actionGroupState === "ENABLED"
                              ? "bg-green-100 text-green-800"
                              : "bg-yellow-100 text-yellow-800"
                          }`}
                        >
                          {actionGroup.actionGroupState}
                        </span>
                      </div>
                      <div>
                        <span className="font-medium">Created:</span>{" "}
                        {new Date(actionGroup.createdAt).toLocaleDateString()}
                      </div>
                      <div>
                        <span className="font-medium">Updated:</span>{" "}
                        {new Date(actionGroup.updatedAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ActionGroupPage;