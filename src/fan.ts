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

type Func = () => boolean;


/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class FanAccessory {
  private service: Service;
  private messages: Message[] = [];
  private justStarted = true;
  private handler: NodeJS.Timeout | null = null;

  private states = {
    Active: 0,
  };

  constructor(
    private readonly platform: MqttFlavoredHarmonyPlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    const client = connect(MQTT_SERVER);

    client.on('connect', () => {
      this.platform.log.info('[FAN] on connect');
      client.subscribe('zigbee2mqtt/0x5c0272fffea013dc');
    });

    client.on('message', (topic, message) => {
      this.platform.log.info('[FAN] MQTT: ' + topic + ' = ' + message);
      if (topic === 'zigbee2mqtt/0x5c0272fffea013dc') {
        const status = JSON.parse(message.toString());
        this.messages.unshift({ power: status.power });
        this.messages = this.messages.slice(0, 5);
        this.platform.log.debug(JSON.stringify(this.messages));
        if (this.justStarted) {
          this.justStarted = false;
          this.states.Active = this.messages[0].power > 0 && 1 || 0;
          this.platform.log.info('just started', this.states.Active);
          this.service.updateCharacteristic(this.platform.Characteristic.Active, this.states.Active);
        }
      }
    });

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Harmony')
      .setCharacteristic(this.platform.Characteristic.Model, 'Harmony')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, platform.api.hap.uuid.generate('Harmony'));

    this.service = this.accessory.getService(this.platform.Service.Fan)
      || this.accessory.addService(this.platform.Service.Fan, 'Fan', 'Fan');

    this.service
      .setCharacteristic(this.platform.Characteristic.Name, 'Fan')
      .setCharacteristic(this.platform.Characteristic.ConfiguredName, 'Fan')
      .setCharacteristic(this.platform.Characteristic.Active, 0)
      .setCharacteristic(this.platform.Characteristic.ActiveIdentifier, -1);

    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .on('set', this.setOn.bind(this))                // SET - bind to the `setOn` method below
      .on('get', this.getOn.bind(this));               // GET - bind to the `getOn` method below

    this.service
      .getCharacteristic(this.platform.Characteristic.ActiveIdentifier)!
      .on(CharacteristicEventTypes.SET, (newValue: CharacteristicValue, callback: CharacteristicSetCallback) => {
        this.platform.log.info('[FAN] set Active Identifier => setNewValue: ' + newValue);
        callback(null);
      });
  }

  async findDevice(): Promise<HarmonyClient.DeviceDescription> {
    const client = await this.platform.ensureHarmonyClient();
    const commands = await client.getAvailableCommands();
    const device = commands.device.find(d => d.label === 'GreenFan');
    if (!device) {
      throw new Error('no greenfan');
    }
    return device;
  }

  clearInterval() {
    if (this.handler) {
      clearInterval(this.handler);
      this.handler = null;
    }
  }

  async send(message: string, func: Func) {
    try {
      const device = await this.findDevice();
      const powerGroup = device.controlGroup[0];
      // const miscGroup = device.controlGroup[1];

      await this.platform.send(powerGroup.function[0].action);

      this.messages = [];

      this.clearInterval();
      this.handler = setInterval(() => {
        this.platform.log.info(message);
        if (this.messages.length === 0) {
          return; 
        }
        if (func()) {
          this.clearInterval();
        }
      }, 500);
    } catch (error) {
      this.platform.log.info('[FAN] HarmonyError: ' + error.message);
    }
  }

  async turnOn() {
    this.send('turning on', () => {
      if (this.messages[0].power > 0) {
        return true;
      }
      this.turnOn();
      return false;
    });
  }

  async turnOff() {
    this.send('turning off', () => {
      if (this.messages[0].power === 0) {
        return true;
      }
      this.turnOff();
      return false;
    });
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

    this.platform.log.info('[FAN] Set Characteristic Active ->', value);

    callback(null);
  }

  getOn(callback: CharacteristicGetCallback) {

    const isOn = this.states.Active;

    this.platform.log.info('[FAN] Get Characteristic Active ->', isOn);

    callback(null, isOn);
  }
}
