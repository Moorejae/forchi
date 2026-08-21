const socialWorkflow = require("./social/index");
const videoWorkflow = require("./video/index");

const WORKFLOW_REGISTRY = {
  social: socialWorkflow,
  video: videoWorkflow,
};

function getWorkflow(name = "social") {
  const workflow = WORKFLOW_REGISTRY[name];
  if (!workflow) {
    throw new Error(`Workflow "${name}" not found in registry`);
  }
  return workflow;
}

module.exports = {
  social: socialWorkflow,
  video: videoWorkflow,
  getWorkflow
};
