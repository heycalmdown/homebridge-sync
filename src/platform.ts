import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { getHarmonyClient, HarmonyClient } from '@harmonyhub/client-ws';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { TelevisionAccessory } from './television';
import { FanAccessory } from './fan';

export const MQTT_SERVER = 'mqtt://localhost';
// export const MQTT_SERVER = 'mqtt://pi';

export class MqttFlavoredHarmonyPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  public harmonyClient: HarmonyClient | null = null;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      
      this.discoverDevices();
    });
  }

  async ensureHarmonyClient() {
    if (this.harmonyClient) {
      return this.harmonyClient;
    }
    this.harmonyClient = await getHarmonyClient('192.168.0.49');
    this.harmonyClient.on(HarmonyClient.Events.DISCONNECTED, () => {
      this.log.error('harmony ws disconnected');
      this.harmonyClient?.connect('192.168.0.49');
    });
    return this.harmonyClient;
  }

  async send(cmd: string) {
    const client = await this.ensureHarmonyClient();

    const encodedAction = cmd.replace(/:/g, '::');
    return client.send('holdAction', encodedAction);
  }

  async turnOn() {
    const client = await this.ensureHarmonyClient();

    try {
      const commands = await client.getAvailableCommands();
      const tv = commands.device[1];
      
      const powerGroup = tv.controlGroup[0];
      // const volumeGroup = tv.controlGroup[2];
      await this.send(powerGroup.function[0].action);

      // client.end();
    } catch (error) {
      this.log.error('HarmonyError: ' + error.message);
    }
  }

  async turnOff() {
    const client = await this.ensureHarmonyClient();

    try {
      const commands = await client.getAvailableCommands();
      const tv = commands.device[1];
      
      const powerGroup = tv.controlGroup[0];
      // const volumeGroup = tv.controlGroup[2];
      await this.send(powerGroup.function[0].action);

      // client.end();
    } catch (error) {
      this.log.error('HarmonyError: ' + error.message);
    }
  }


  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  discoverDevices() {

    // EXAMPLE ONLY
    // A real plugin you would discover accessories from the local network, cloud services
    // or a user-defined array in the platform config.
    const exampleDevices = [
      {
        exampleUniqueId: 'ABCD',
        exampleDisplayName: 'Television',
        type: 'TELEVISION',
        label: 'TV'
      },
      {
        exampleUniqueId: 'EFGH',
        exampleDisplayName: 'Fan',
        type: 'FAN',
        label: 'GreenFan'
      }
    ];

    for (const device of exampleDevices) {
      const uuid = this.api.hap.uuid.generate(device.exampleUniqueId);

      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

      if (existingAccessory) {
        if (device) {
          this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

          if (device.type === 'TELEVISION') {
            new TelevisionAccessory(this, existingAccessory);
          } else if (device.type === 'FAN') {
            new FanAccessory(this, existingAccessory);
          }
          
          this.api.updatePlatformAccessories([existingAccessory]);
        } else if (!device) {
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
          this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
        }
      } else {
        this.log.info('Adding new accessory:', device.exampleDisplayName);

        if (device.type === 'TELEVISION') {
          const accessory = new this.api.platformAccessory(device.exampleDisplayName, uuid, this.api.hap.Categories.TELEVISION);
          accessory.context.device = device;
  
          new TelevisionAccessory(this, accessory);
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
        } else if (device.type === 'FAN') {
          const accessory = new this.api.platformAccessory(device.exampleDisplayName, uuid, this.api.hap.Categories.FAN);
          accessory.context.device = device;
  
          new FanAccessory(this, accessory);
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
        }
      }
    }
  }
}
