import { getHarmonyClient } from '@harmonyhub/client-ws';


async function main() {
  const harmonyClient = await getHarmonyClient('192.168.0.49');
  const commands = await harmonyClient.getAvailableCommands();
  console.dir(commands.device, { depth: 10 });
  harmonyClient.end();
}

main();
