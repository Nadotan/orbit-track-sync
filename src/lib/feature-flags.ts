// One switch controls the Clock page everywhere.
//
// false -> the Clock is hidden from the sidebar and the bottom navigation, and
//          "/", "/clock" and "/tracker" all land on the Meetings Hub.
// true  -> the Clock returns to the navigation and the "/clock" route works.
export const CLOCK_ENABLED: boolean = false;
