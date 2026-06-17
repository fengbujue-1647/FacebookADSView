const { createInterface } = require("node:readline/promises");
const { stdin: input, stdout: output, exit } = require("node:process");
const {
  initAuthDatabase,
  createUser,
  getUserByUsername,
  updateUser,
  resetUserPassword
} = require("../src/authStore");

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

async function promptForPassword(rl) {
  const first = await rl.question("Password: ");
  const second = await rl.question("Confirm password: ");
  if (first !== second) {
    throw new Error("两次输入的密码不一致");
  }
  return first;
}

async function main() {
  initAuthDatabase();
  const username = argValue("username", "admin");
  const displayName = argValue("display-name", "管理员");
  const passwordArg = argValue("password", "");
  const reset = process.argv.includes("--reset-password");
  const rl = createInterface({ input, output });
  try {
    const password = passwordArg || await promptForPassword(rl);
    const existing = getUserByUsername(username);
    if (existing && !reset) {
      updateUser(existing.id, {
        displayName,
        role: "admin",
        status: "active"
      });
      console.log(`管理员已存在，已确保启用：admin username=${username}`);
      return;
    }
    if (existing && reset) {
      resetUserPassword(existing.id, password);
      updateUser(existing.id, {
        displayName,
        role: "admin",
        status: "active"
      });
      console.log(`管理员密码已重置：admin username=${username}`);
      return;
    }
    createUser({
      username,
      password,
      displayName,
      role: "admin",
      status: "active"
    });
    console.log(`管理员已创建：admin username=${username}`);
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  exit(1);
});
