/**
 * QR codes made by segno, an independent Python encoder, as module grids:
 * each is the rows' bits run together and written in hex.
 */

export interface QrFixture {
  text: string;
  size: number;
  hex: string;
}

export const SEGNO_FIXTURES: Record<string, QrFixture> = {
  v10: {
    text: "key.is: 012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789",
    size: 57,
    hex:
      "fee75e62f8a73fc1465cc47328906eacdd956627cbb749df2674aca5dba2693fe61a12ec178f731c6a1107faaaaaaaaaaafe011c83c591e7003a886e" +
      "fe0d277394efb7c2545949f5ab66372f113e9c036bf10513d16830f79e9ef616556f3d929ccd043fbb58ace4fd2f99295381e695fb44ef0d69760921" +
      "1404fda6c7945e41e4aa07904f90bc80035b21e5131164f0cfe6cef677576f2d9ed4cd24d4bb56b0d6fcafdda1518fe196bb54ef04667688811664f5" +
      "298514ee4527ef80dfcfa8be611159bc5b2711d4a98f62b5ea6a9f474dcf10cd247cbfee78f81b2be1b921b705e5fac6ca5a564ec1608cf8d6048504" +
      "deb9e4e192ce5390c7853854ba13d51e473f09e7743266d66c4f0d913165bea9ce19a02529a0fbf107092dcb061bdac7c6ab78acf012ac3d07d629d4" +
      "f5accc5a16079f24769d2317b646370beef2d222d1e4490899c1e6be9ec016e3354c21f0b7800821fbc603dac33fad66fc80501cf1c4d645ff956cfa" +
      "fb10ab904446cc5317314baf33dffaf22fd5d4592ab1d1eae2eadc058d24ca0104be8551207b18fe4f4ed929667b0",
  },
  kanji: {
    text: "\u70b9\u8317\u65e5\u672c",
    size: 21,
    hex:
      "fe7bfc11906e94bb7485dbafaec10d07faafe01c0033e6830acaecf19cf1b96522318076f3fba8904ad0ba4d9dd7bbaebf2904c81fe49f8",
  },
  eci: {
    text: "gr\u00fc\u00dfe \u20ac",
    size: 21,
    hex:
      "fe53fc16506eaebb75f5dba4aec11907faafe0100082f672687ba5d2a3839acebbb18074f3f8cd504854ba608dd332ae9f1f04937fea3d0",
  },
  latin1: {
    text: "caf\u00e9",
    size: 21,
    hex:
      "fe3bfc17906ea0bb75d5dbac2ec17907faafe00a0027adf0ec6861ad6af992bfaabd805327faf1305d5cba424dd1b12ebb6f04840fe0fe8",
  },
};

/** A fixture's grid, 1 for dark. */
export function fixtureModules(fixture: QrFixture): Uint8Array {
  const modules = new Uint8Array(fixture.size * fixture.size);
  for (let index = 0; index < modules.length; index += 1) modules[index] = (parseInt(fixture.hex[index >> 2], 16) >> (3 - (index & 3))) & 1;
  return modules;
}
