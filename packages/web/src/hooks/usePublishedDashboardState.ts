import { useState } from 'react';
import { useUiStore } from '../store/uiStore.js';
import { useDashboardFlow } from './dashboard/useDashboardFlow.js';
import { useDashboardWebSocket } from './dashboard/useDashboardWebSocket.js';
import { useDashboardActions } from './dashboard/useDashboardActions.js';
import { useDashboardLayout } from './dashboard/useDashboardLayout.js';
import { useDashboardScreenshot } from './dashboard/useDashboardScreenshot.js';

export function usePublishedDashboardState(flowId: string) {
  const isDarkMode = useUiStore((s) => s.isDarkMode);
  const toggleDarkMode = useUiStore((s) => s.toggleDarkMode);

  const [executingNodes, setExecutingNodes] = useState<Record<string, boolean>>({});

  const flow = useDashboardFlow(flowId);

  useDashboardWebSocket({
    graphRef: flow.graphRef,
    setExecutingNodes,
    setNodeData: flow.setNodeData,
    setFormInputs: flow.setFormInputs,
  });

  const actions = useDashboardActions({
    flowId,
    dashboardPassword: flow.dashboardPassword,
    flowName: flow.flowName,
    nodeData: flow.nodeData,
    formInputs: flow.formInputs,
    graphRef: flow.graphRef,
    setFlowName: flow.setFlowName,
    setIsLocked: flow.setIsLocked,
    setDashboardPassword: flow.setDashboardPassword,
    setNodes: flow.setNodes,
    setNodeData: flow.setNodeData,
    setLayout: flow.setLayout,
    setFormInputs: flow.setFormInputs,
    setExecutingNodes,
  });

  const layoutHelpers = useDashboardLayout(flow.layout);

  const screenshot = useDashboardScreenshot({
    containerRef: layoutHelpers.containerRef,
    isDarkMode,
    flowName: flow.flowName,
  });

  const getFieldOptions = (_node: any, field: any) => field.options || [];

  return {
    flowName: flow.flowName,
    nodes: flow.nodes,
    nodeData: flow.nodeData,
    layout: flow.layout,
    isLoading: flow.isLoading,
    error: flow.error,
    isLocked: flow.isLocked,
    dashboardPassword: flow.dashboardPassword,
    formInputs: flow.formInputs,
    isDarkMode,
    toggleDarkMode,
    executingNodes,
    containerRef: layoutHelpers.containerRef,
    width: layoutHelpers.width,
    fontSizes: layoutHelpers.fontSizes,
    imageZooms: layoutHelpers.imageZooms,
    copiedTextNode: layoutHelpers.copiedTextNode,
    isCapturing: screenshot.isCapturing,
    screenshotSuccess: screenshot.screenshotSuccess,
    passwordInput: actions.passwordInput,
    lockError: actions.lockError,
    isUnlocking: actions.isUnlocking,
    showPassword: actions.showPassword,
    uploadingNodes: actions.uploadingNodes,
    getFieldOptions,
    handleScreenshot: screenshot.handleScreenshot,
    handleUnlock: actions.handleUnlock,
    handleFormSubmit: actions.handleFormSubmit,
    handleInputChange: actions.handleInputChange,
    handleFileUpload: actions.handleFileUpload,
    handleFileRemove: actions.handleFileRemove,
    handleTableSelect: actions.handleTableSelect,
    getResponsiveLayout: layoutHelpers.getResponsiveLayout,
    setFontSizes: layoutHelpers.setFontSizes,
    setImageZooms: layoutHelpers.setImageZooms,
    setCopiedTextNode: layoutHelpers.setCopiedTextNode,
    setPasswordInput: actions.setPasswordInput,
    setShowPassword: actions.setShowPassword,
  };
}
