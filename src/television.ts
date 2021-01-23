import { HarmonyClient } from '@harmonyhub/client-ws';
import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
  CharacteristicSetCallback,
  CharacteristicGetCallback,
  CharacteristicEventTypes,
} from 'homebridge';
import { connect } from 'mqtt';

import { MqttFlavoredHarmonyPlatform, MQTT_SERVER } from './platform';

interface Message {
  power: number;
}

const MIN_POWER = 0;
const THRESHOLD = 5;
const MAX_POWER = 190;
/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class TelevisionAccessory {
  private service: Service;
  private speakerService: Service;
  private messages: Message[] = [];
  private justStarted = true;
  private handler: NodeJS.Timeout | null = null;

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private states = {
    Active: 0,
  };

  constructor(
    private readonly platform: MqttFlavoredHarmonyPlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    const client = connect(MQTT_SERVER);

    client.on('connect', () => {
      this.platform.log.info('[TV] on connect');
      client.subscribe('zigbee2mqtt/0x24fd5b00010d0659');
    });

    client.on('message', (topic, message) => {
      if (topic === 'zigbee2mqtt/0x24fd5b00010d0659') {
        const status = JSON.parse(message.toString());
        this.messages.unshift({ power: status.power });
        this.messages = this.messages.slice(0, 5);
        this.platform.log.debug('[TV] ' + JSON.stringify(this.messages));

        if (this.justStarted || this.messages.length === 5) {
          const averagePower = (this.messages.reduce((p, v) => p + v.power, 0) / this.messages.length);
          this.justStarted = false;
          this.states.Active = averagePower > THRESHOLD && 1 || 0;
          this.service.updateCharacteristic(this.platform.Characteristic.Active, this.states.Active);
        }
      }
    });

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Harmony')
      .setCharacteristic(this.platform.Characteristic.Model, 'Harmony')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, platform.api.hap.uuid.generate('Harmony'));

    this.service = this.accessory.getService(this.platform.Service.Television)
      || this.accessory.addService(this.platform.Service.Television, 'Television', 'Television');

    this.service
      .setCharacteristic(this.platform.Characteristic.Name, 'Television')
      .setCharacteristic(this.platform.Characteristic.ConfiguredName, 'Television')
      .setCharacteristic(this.platform.Characteristic.Active, 0)
      .setCharacteristic(this.platform.Characteristic.ActiveIdentifier, -1)
      .setCharacteristic(
        this.platform.Characteristic.SleepDiscoveryMode,
        this.platform.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE,
      );

    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .on('set', this.setOn.bind(this))                // SET - bind to the `setOn` method below
      .on('get', this.getOn.bind(this));               // GET - bind to the `getOn` method below

    this.service
      .getCharacteristic(this.platform.Characteristic.ActiveIdentifier)!
      .on(CharacteristicEventTypes.SET, (newValue: CharacteristicValue, callback: CharacteristicSetCallback) => {
        this.platform.log.info('set Active Identifier => setNewValue: ' + newValue);
        callback(null);
      });


    this.service
      .getCharacteristic(this.platform.Characteristic.RemoteKey)!
      .on(CharacteristicEventTypes.SET, async (newValue: CharacteristicValue, callback: CharacteristicSetCallback) => {
        this.platform.log.info('set Remote Key => setNewValue: ' + newValue);
        try {
          const tv = await this.findDevice();
          let action: string | null = null;
          switch (newValue) {
            case this.platform.Characteristic.RemoteKey.INFORMATION:
              action = tv.controlGroup[14].function[5].action;
              break;
            case this.platform.Characteristic.RemoteKey.ARROW_UP:
              action = tv.controlGroup[4].function[3].action;
              break;
            case this.platform.Characteristic.RemoteKey.ARROW_DOWN:
              action = tv.controlGroup[4].function[0].action;
              break;
            case this.platform.Characteristic.RemoteKey.ARROW_LEFT:
              action = tv.controlGroup[4].function[1].action;
              break;
            case this.platform.Characteristic.RemoteKey.ARROW_RIGHT:
              action = tv.controlGroup[4].function[2].action;
              break;
            case this.platform.Characteristic.RemoteKey.SELECT:
              action = tv.controlGroup[4].function[4].action;
              break;
          }
          if (action) {
            await this.platform.send(action);
          }
        } catch (error) {
          this.platform.log.error('HarmonyError: ' + error.message);
        }
        callback(null);
      });

    this.speakerService = this.accessory.getService(this.platform.Service.TelevisionSpeaker)
      || this.accessory.addService(this.platform.Service.TelevisionSpeaker);
    this.speakerService
      .setCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.ACTIVE)
      .setCharacteristic(this.platform.Characteristic.VolumeControlType, this.platform.Characteristic.VolumeControlType.ABSOLUTE);

    // handle volume control
    this.speakerService.getCharacteristic(this.platform.Characteristic.VolumeSelector)
      .on(CharacteristicEventTypes.SET, async (newValue: CharacteristicValue, callback: CharacteristicSetCallback) => {
        this.platform.log.info('set VolumeSelector => setNewValue: ' + newValue);
        try {
          const tv = await this.findDevice();

          const volumeGroup = tv.controlGroup[2];
          await this.platform.send(volumeGroup.function[newValue === 0 && 2 || 1].action);
        } catch (error) {
          this.platform.log.error('HarmonyError: ' + error.message);
        }

        callback(null);
      });
  }

  async findDevice(): Promise<HarmonyClient.DeviceDescription> {
    const client = await this.platform.ensureHarmonyClient();
    const commands = await client.getAvailableCommands();
    const device = commands.device.find(d => d.label === 'TV');
    if (!device) {
      throw new Error('no TV');
    }
    return device;
  }

  clearInterval() {
    if (this.handler) {
      clearInterval(this.handler);
      this.handler = null;
    }
  }

  async send(message: string, predicate: () => boolean, action: () => void) {
    try {
      this.messages = [];
      this.clearInterval();
      let checked = 0;
      let sent = 0;
      sent++;
      action();
      this.handler = setInterval(() => {
        checked++;
        this.platform.log.info(`[TV] ${message} checked(${checked}) sent(${sent})`);
        if (this.messages.length < 2) {
          return; 
        }

        if (predicate()) {
          this.clearInterval();
        } else {
          sent++;
          this.messages = [];
          action();
        }
      }, 1000);
    } catch (error) {
      this.platform.log.info('[TV] HarmonyError: ' + error.message);
    }
  }

  async powerToggle() {
    const device = await this.findDevice();
    const powerGroup = device.controlGroup[0];
    // const miscGroup = device.controlGroup[1];

    this.platform.log.info('[TV]', powerGroup.function[0].action);
    await this.platform.send(powerGroup.function[0].action);
  }

  async turnOn() {
    this.send('turning on', () => this.messages[0].power > THRESHOLD + MIN_POWER, () => this.powerToggle());
  }

  async turnOff() {
    this.send('turning off', () => this.messages[0].power < MAX_POWER - THRESHOLD, () => this.powerToggle());
  }

  setOn(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    const active = value as number;
    if (this.states.Active === active) {
      return;
    }
    if (active === 1) {
      this.turnOn();
    } else {
      this.turnOff();
    }
    this.states.Active = active;

    this.platform.log.info('Set Characteristic Active ->', value);

    // you must call the callback function
    callback(null);
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   * 
   * GET requests should return as fast as possbile. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   * 
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.

   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  getOn(callback: CharacteristicGetCallback) {

    // implement your own code to check if the device is on
    const isOn = this.states.Active;

    this.platform.log.info('[TV] Get Characteristic Active ->', isOn);

    // you must call the callback function
    // the first argument should be null if there were no errors
    // the second argument should be the value to return
    callback(null, isOn);
  }
}
