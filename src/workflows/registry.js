const socialWorkflow = require("./social/index");

const WORKFLOW_REGISTRY = {
  social: socialWorkflow
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
  getWorkflow
};
