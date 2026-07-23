# Makefile for the LED matrix renderer.
# Links against the hzeller/rpi-rgb-led-matrix library checked out at
# ~/led-frame/rpi-rgb-led-matrix.

CXX ?= g++
CXXFLAGS ?= -Wall -O3 -g -std=c++11

# Location of the rpi-rgb-led-matrix checkout.
RGB_LIB_DISTRIBUTION = $(HOME)/led-frame/rpi-rgb-led-matrix
RGB_INCDIR = $(RGB_LIB_DISTRIBUTION)/include
RGB_LIBDIR = $(RGB_LIB_DISTRIBUTION)/lib
RGB_LIBRARY_NAME = rgbmatrix
RGB_LIBRARY = $(RGB_LIBDIR)/lib$(RGB_LIBRARY_NAME).a

LDFLAGS += -L$(RGB_LIBDIR) -l$(RGB_LIBRARY_NAME) -lrt -lm -lpthread

SRCDIR = src
OBJDIR = obj
BINARY = renderer

SOURCES = $(SRCDIR)/main.cpp
OBJECTS = $(OBJDIR)/main.o

all: $(BINARY)

$(RGB_LIBRARY): FORCE
	$(MAKE) -C $(RGB_LIBDIR)

$(OBJDIR)/%.o: $(SRCDIR)/%.cpp | $(OBJDIR)
	$(CXX) -I$(RGB_INCDIR) $(CXXFLAGS) -c -o $@ $<

$(OBJDIR):
	mkdir -p $(OBJDIR)

$(BINARY): $(OBJECTS) $(RGB_LIBRARY)
	$(CXX) $(OBJECTS) -o $@ $(LDFLAGS)

clean:
	rm -rf $(OBJDIR) $(BINARY)

FORCE:

.PHONY: all clean FORCE
