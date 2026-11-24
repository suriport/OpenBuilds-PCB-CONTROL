// PCB-Control: start screen (splash) with the PCB-Control logo.
//
// Replaces initSplash() and animateSplash() from app/js/main.js, which load the animated
// Groove Control logo. This file must be included AFTER main.js: the later function
// declaration wins. Timing stays the same as in GrooveControl (also used by theme.js when
// the theme is changed). Nothing here sends anything to the machine.

/* global $ */
/* exported initSplash, animateSplash */

const PCB_SPLASH_BACKGROUND = '#fcfcfc'; // background color of the logo image

async function initSplash() {
  $('#splash').css('background-color', PCB_SPLASH_BACKGROUND);
  $('#logosplash').html('<img src="./img/pcb/pcb-control-logo.png" alt="PCB-Control" style="width:400px; max-width:80vw;">');
  animateSplash();
}

function animateSplash() {
  $('#logosplash').fadeIn(100);
  setTimeout(function() {
    $('#splash').fadeOut(500);
  }, 1500);
}
