import { assert, assertEquals } from "@std/assert";
import { isStringFormat, matchesFormat, type StringFormat } from "./formats.ts";

const cases: Record<StringFormat, { valid: string[]; invalid: string[] }> = {
  "date": {
    valid: ["2024-02-29", "2023-12-31", "0001-01-01"],
    invalid: ["2023-02-29", "2024-13-01", "2024-00-10", "2024-04-31", "x", ""],
  },
  "time": {
    valid: ["23:59:59", "12:00:00Z", "12:00:00.5+01:00", "23:59:60Z"],
    invalid: [
      "24:00:00",
      "12:60:00",
      "12:00:00+24:00",
      "12:00:00+01:60",
      "noon",
    ],
  },
  "date-time": {
    valid: ["2024-02-29T12:00:00Z", "2024-02-29T12:00:00.123+02:00"],
    invalid: ["2024-02-30T12:00:00Z", "2024-02-29T25:00:00Z", "2024-02-29"],
  },
  "duration": {
    valid: ["P1Y2M3DT4H5M6S", "PT1H", "P2W", "P1D"],
    invalid: ["P", "PT", "1D", "P1DT"],
  },
  "hostname": {
    valid: ["localhost", "example.com", "a-b.example.com", "a1.b2", "a.com."],
    invalid: [
      "-a.com",
      "a-.com",
      "a..com",
      "a b.com",
      "a".repeat(64) + ".com",
      "",
    ],
  },
  "idn-hostname": {
    valid: ["localhost", "bücher.de", "例え.jp"],
    invalid: ["-a.com", "a..com", "a b.com"],
  },
  "ipv4": {
    valid: ["0.0.0.0", "192.168.1.1", "255.255.255.255"],
    invalid: ["256.1.1.1", "01.1.1.1", "1.1.1", "1.1.1.1.1", "a.b.c.d"],
  },
  "ipv6": {
    valid: [
      "::",
      "::1",
      "1::",
      "2001:db8::ff00:42:8329",
      "1:2:3:4:5:6:7:8",
      "::ffff:1.2.3.4",
      "64:ff9b::192.0.2.33",
      "1:2:3:4:5:6:1.2.3.4",
      "2001:db8::1:192.0.2.33",
      "1::d6:192.168.0.1",
      "1:2:3:4:5::1.2.3.4",
      "::1:192.168.0.1",
      "::1:2:3:4:5:1.2.3.4",
      "1:2::3:4:5:6",
      "2001:DB8::1",
      "2001:0db8:0000:0000:0000:0000:0000:0001",
    ],
    invalid: [
      "1:2:3:4:5:6:7",
      ":::",
      "1::2::3",
      "12345::",
      "g::1",
      "::1.2.3",
      ":2:3:4:5:6:7:8",
      "1:2:3:4:5:6:7:",
      "1:2:3:4:5:6:7:8::",
      "1::2:192.168.256.1",
      "::ffff:192.168.0.01",
      "127.0.0.1",
      "fe80::/64",
      "fe80::a%eth1",
      "[::1]",
      "::1]/x[",
      "  ::1",
      "::1\n",
      "1:2:3:4:5:6:7:৪",
      "",
    ],
  },
  "uri": {
    valid: [
      "https://example.com/a?b=c#d",
      "mailto:a@b.com",
      "urn:isbn:0451450523",
      "http://[::1]:80/",
      "a:%20",
    ],
    invalid: [
      "example.com",
      "http://a b",
      "/relative",
      "http://a/%zz",
      "1a:b",
    ],
  },
  "uri-reference": {
    valid: [
      "https://example.com",
      "/path/x",
      "relative/path",
      "#frag",
      "",
      "?q=1",
    ],
    invalid: ["http://a.com bad value", "a\\b", "%zz", "<a>"],
  },
  "iri": {
    valid: ["https://例え.jp/パス", "mailto:ü@b.com"],
    invalid: ["例え.jp", "http://a b"],
  },
  "iri-reference": {
    valid: ["https://例え.jp", "/パス", "relative", ""],
    invalid: ["a b", "a\\b"],
  },
  "uri-template": {
    valid: ["https://x.com/{id}", "/users{?a,b}", "plain"],
    invalid: ["https://x.com/{a b}", "a b"],
  },
  "json-pointer": {
    valid: ["", "/", "/foo/0", "/a~0b/c~1d", "//"],
    invalid: ["foo", "/a~2", "/a~"],
  },
  "relative-json-pointer": {
    valid: ["0", "1/foo", "2#", "0/a~1b", "10"],
    invalid: ["/foo", "01", "0abc", "-1", ""],
  },
  "regex": { valid: ["^a+$", "[a-z]{2,}"], invalid: ["(", "[a-"] },
  "uuid": {
    valid: [
      "123e4567-e89b-12d3-a456-426614174000",
      "123E4567-E89B-12D3-A456-426614174000",
    ],
    invalid: ["123e4567e89b12d3a456426614174000", "x", ""],
  },
  "email": {
    valid: [
      "a@b.co",
      "a.b+c@d.example",
      "o'brien@example.com",
      "te~st@example.com",
      "!#$%&'*+-/=?^_`{|}~@example.com",
      "user@example.xn--p1ai",
      "test@c--n.com",
      "test@255.255.255.255",
      "test@io",
      '"joe bloggs"@example.com',
      '"joe..bloggs"@example.com',
      '"joe@bloggs"@example.com',
      '""@iana.org',
      '"\\""@iana.org',
      "joe.bloggs@[127.0.0.1]",
      "joe.bloggs@[IPv6:::1]",
      "a@[ipv6:2001:db8::1]",
    ],
    invalid: [
      "@b.co",
      "",
      "2962",
      ".a@example.com",
      "a.@example.com",
      "a..b@example.com",
      "a@-.com",
      "a@iana-.com",
      "a@.iana.org",
      "a@iana.org.",
      "a@iana..com",
      "a@invalid=domain.com",
      "a@",
      "a@b@c.org",
      "a b@example.com",
      "a,b@iana.org",
      'a"b@iana.org',
      '"a"b@iana.org',
      '"a@iana.org',
      '"a\\©"@iana.org',
      "aé@iana.org",
      "a@é.org",
      "a＠iana.org",
      "a@iana.org\n",
      " a@iana.org",
      "a@[127.0.0.300]",
      "a@[1.2.3]",
      "a@[]",
      "a@[1.2.3.4",
      "a@[IPv6:1::2::3]",
      "a@[RFC-5322-domain-literal]",
      "[1.2.3.4]@iana.org",
    ],
  },
  "idn-email": {
    valid: [
      "ü@bücher.de",
      "a@b.co",
      "실례@실례.테스트",
      "δοκιμή@example.com",
      '"δοκιμή"@example.com',
      "a@उदाहरण.भारत",
      "user@bücher.xn--fiqs8s",
      "user@café.com",
      "𝕏@example.com",
      "a@[IPv6:::1]",
    ],
    invalid: [
      "ü@",
      "",
      "2962",
      "user＠example.com",
      ".ü@example.com",
      "ü..b@example.com",
      "δοκιμή@-example.com",
      "δοκιμή@example-.com",
      "δοκιμή@.example.com",
      "δοκιμή@example.com.",
      "δοκιμή@example..com",
      "a b@example.com",
    ],
  },
};

for (const [format, { valid, invalid }] of Object.entries(cases)) {
  Deno.test(`format ${format}`, () => {
    assert(isStringFormat(format));
    for (const value of valid) {
      assert(matchesFormat(value, format), `${format} should accept ${value}`);
    }
    for (const value of invalid) {
      assert(
        !matchesFormat(value, format),
        `${format} should reject ${value}`,
      );
    }
  });
}

Deno.test("isStringFormat", () => {
  for (const format of Object.keys(cases)) assert(isStringFormat(format));
  for (const format of ["nope", "", "Email", "toString", "constructor"]) {
    assertEquals(isStringFormat(format), false, format);
  }
});
